const BaseScraper = require('./base-scraper');
const { getCurrentBillingPeriod } = require('../utils/helpers');

class InwiScraper extends BaseScraper {
    constructor() {
        super('Inwi');
        this.fastPayUrl = 'https://factureonline.inwi.ma/PFEL/init';
    }

    async checkBills() {
        const db = require('../db/database');
        const phoneNumber = (await db.getSetting('inwiPhone')) || process.env.INWI_PHONE_NUMBER;
        
        if (!phoneNumber) {
            throw new Error('INWI_PHONE_NUMBER not configured in environment or settings.');
        }

        const startTime = Date.now();
        
        try {
            console.log(`[${this.name}] Calling Inwi Billing API directly...`);
            
            // Format phone number: the API expects '2125...' instead of '05...'
            let apiPhone = phoneNumber;
            if (apiPhone.startsWith('0')) {
                apiPhone = '212' + apiPhone.substring(1);
            }
            
            // The sdata header is required by Inwi's API:
            const sdata = "eyJ1dWlkIjoiNjBlNGUzNjctZmRlZS00M2E5LWEyMTctNjIwMTY4YWIyMWI4IiwiY2hhbm5lbCI6IndlYiIsImFwcGxpY2F0aW9uX29yaWdpbiI6Imlud2kubWEiLCJsYW5ndWFnZSI6IltdIiwiYXBwVmVyc2lvbiI6MX0=";

            const url = `https://api.inwi.ma/api/v1/ms-billing/invoices/b2c/search/${apiPhone}`;
            const options = {
                method: 'GET',
                headers: {
                    'accept': '*/*',
                    'sdata': sdata,
                    'origin': 'https://inwi.ma',
                    'referer': 'https://inwi.ma/',
                    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36'
                }
            };
            
            console.log(`\n>>> [INWI SCRAPER] Sending GET to: ${url}`);
            console.log('>>> [INWI SCRAPER] Headers:');
            console.dir(options.headers, { depth: null, colors: true });

            const response = await fetch(url, options);

            if (!response.ok) {
                console.error(`<<< [INWI SCRAPER] Error Response: ${response.status} ${response.statusText}`);
                throw new Error(`Inwi API returned ${response.status} ${response.statusText}`);
            }

            const invoices = await response.json();
            console.log('<<< [INWI SCRAPER] Success Response:');
            console.dir(invoices, { depth: null, colors: true });
            console.log('\n');
            const bills = [];

            if (Array.isArray(invoices) && invoices.length > 0) {
                for (const invoice of invoices) {
                    if (invoice.amountDue > 0) {
                        let dueDate = null;
                        if (invoice.paymentDueDate) {
                            dueDate = new Date(invoice.paymentDueDate.replace('[UTC]', '')).toLocaleDateString('fr-FR');
                        }

                        let billingPeriod = getCurrentBillingPeriod();
                        if (invoice.billDate) {
                            const d = new Date(invoice.billDate.replace('[UTC]', ''));
                            billingPeriod = d.toLocaleString('fr-FR', { month: 'long', year: 'numeric' });
                            billingPeriod = billingPeriod.charAt(0).toUpperCase() + billingPeriod.slice(1);
                        }

                        bills.push({
                            provider: this.name,
                            invoice_number: invoice.billNo || null,
                            amount: invoice.amountDue,
                            billing_period: billingPeriod,
                            due_date: dueDate,
                            status: 'unpaid',
                            payment_url: 'https://inwi.ma/fr/paiement-facture/paiement',
                            raw_data: invoice
                        });
                    }
                }
            }

            return {
                provider: this.name,
                success: true,
                bills: bills,
                duration_ms: Date.now() - startTime
            };
            
        } catch (error) {
            console.error(`[${this.name}] API Fetch failed:`, error.message);
            
            return {
                provider: this.name,
                success: false,
                error_message: error.message,
                screenshot_path: null,
            };
        }
    }

    async resolveCmiPaymentLink(phoneNumber, onLog = console.log) {
        let browser, context, page;
        try {
            onLog(`🚀 Initializing background Playwright browser (Stealth Mode)...`);
            const { chromium } = require('playwright-extra');
            const stealth = require('puppeteer-extra-plugin-stealth')();
            chromium.use(stealth);
            browser = await chromium.launch({
                headless: true,
                args: [
                    '--disable-blink-features=AutomationControlled',
                    '--no-sandbox',
                    '--disable-setuid-sandbox'
                ]
            });
            context = await browser.newContext({
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
                viewport: { width: 1366, height: 768 },
                extraHTTPHeaders: {
                    'X-Forwarded-For': '196.200.180.20',
                    'X-Real-IP': '196.200.180.20'
                }
            });
            await context.addInitScript(() => {
                Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            });
            page = await context.newPage();
            
            let cmiUrl = null;
            
            // Listen for CMI URL in response headers AND response bodies
            page.on('response', async (response) => {
                if (cmiUrl) return; // Already found
                const headers = response.headers();
                
                // Check x-action-redirect header (Next.js Server Action redirect)
                const redirectHeader = headers['x-action-redirect'];
                if (redirectHeader && redirectHeader.includes('cmi.co.ma')) {
                    cmiUrl = redirectHeader.split(';')[0];
                    onLog(`🎯 Intercepted CMI redirect header: ${cmiUrl}`);
                    return;
                }
                
                // Check location header for 3xx redirects
                if (headers['location'] && headers['location'].includes('cmi.co.ma')) {
                    cmiUrl = headers['location'];
                    onLog(`🎯 Intercepted CMI location header: ${cmiUrl}`);
                    return;
                }
                
                // Check response body for CMI URLs (for inwi.ma responses only)
                const url = response.url();
                if (url.includes('inwi.ma') && !url.includes('google') && !url.includes('doubleclick')) {
                    try {
                        const body = await response.text().catch(() => '');
                        const match = body.match(/https?:\/\/[^\s"'<>]*cmi\.co\.ma[^\s"'<>]*/);
                        if (match) {
                            cmiUrl = match[0];
                            onLog(`🎯 Found CMI URL in response body: ${cmiUrl}`);
                        }
                    } catch {}
                }
            });

            // ===== STEP 1: Navigate =====
            onLog(`🌐 Navigating to Inwi payment portal...`);
            await page.goto('https://inwi.ma/fr/paiement-facture', { 
                waitUntil: 'domcontentloaded', 
                timeout: 30000 
            });
            onLog(`📍 Page loaded: ${page.url()}`);

            // ===== STEP 2: Fill form =====
            onLog(`✍️ Entering phone number: ${phoneNumber}...`);
            await page.waitForSelector('input#phone', { timeout: 15000 });
            await page.fill('input#phone', phoneNumber);

            // Fill confirmation
            try {
                await page.fill('input#phoneconfirmation', phoneNumber);
                onLog(`✍️ Phone number confirmation filled`);
            } catch {}

            // Fill email
            try {
                const db = require('../db/database');
                const userEmail = (await db.getSetting('senderEmail')) || process.env.EMAIL_RECIPIENT || 'achrafrachid51@gmail.com';
                await page.fill('input#email', userEmail);
                onLog(`✍️ Email filled: ${userEmail}`);
            } catch {}

            // ===== STEP 3: Click Confirmer =====
            onLog(`👆 Clicking Confirm...`);
            // Click the "Confirmer" button using evaluate to bypass detached DOM or overlay issues
            await page.evaluate(() => {
                const buttons = Array.from(document.querySelectorAll('button'));
                const confirmBtn = buttons.find(b => b.textContent.trim() === 'Confirmer');
                if (confirmBtn) {
                    confirmBtn.click();
                } else {
                    // Fallback to searching inside shadow DOM or just returning
                    const anyConfirm = buttons.find(b => b.textContent.includes('Confirmer'));
                    if (anyConfirm) anyConfirm.click();
                }
            }).catch(() => {});
            
            // Also press Enter as a fallback
            await page.keyboard.press('Enter').catch(() => {});

            // Wait for Step 2 page to load (invoices list)
            onLog(`⏳ Waiting for invoices to load...`);
            await page.waitForURL('**/paiement-facture/paiement**', { timeout: 30000 }).catch(() => {});
            await page.waitForTimeout(3000);
            onLog(`📍 Invoices page loaded: ${page.url()}`);

            // ===== STEP 4: Select invoice via hidden checkbox =====
            // The invoice checkbox is: <input id="option-XXXXX" class="peer hidden" type="checkbox">
            // Wrapped in: <label for="option-XXXXX">
            // We need to click the label OR use JavaScript to check the checkbox
            
            onLog(`🔍 Searching for invoice to select...`);
            
            // Method 1: Click the <label> element that wraps the hidden checkbox
            const label = await page.$('label[for^="option-"]');
            if (label) {
                await label.click();
                onLog(`✅ Invoice selected via label click`);
            } else {
                // Method 2: Use JavaScript to directly check the hidden checkbox and dispatch change event
                const checked = await page.evaluate(() => {
                    const checkbox = document.querySelector('input[type="checkbox"][id^="option-"]');
                    if (checkbox) {
                        checkbox.checked = true;
                        checkbox.dispatchEvent(new Event('change', { bubbles: true }));
                        checkbox.dispatchEvent(new Event('input', { bubbles: true }));
                        // Also try clicking the parent/label
                        const parentLabel = checkbox.closest('label') || document.querySelector(`label[for="${checkbox.id}"]`);
                        if (parentLabel) parentLabel.click();
                        return true;
                    }
                    return false;
                });
                if (checked) {
                    onLog(`✅ Invoice selected via JS checkbox toggle`);
                } else {
                    // Method 3: Click the invoice card div itself
                    const cardDiv = await page.$('div:has(input[type="checkbox"][id^="option-"])');
                    if (cardDiv) {
                        await cardDiv.click();
                        onLog(`✅ Invoice selected via card div click`);
                    } else {
                        onLog(`⚠️ No invoice found to select`);
                    }
                }
            }

            // Wait for React state update (Total should change from 0 to 149)
            await page.waitForTimeout(2000);
            
            // Verify: Check if Payer button is now enabled
            const payerDisabled = await page.$eval(
                'button:has-text("Payer")', 
                btn => btn.disabled
            ).catch(() => true);
            
            if (payerDisabled) {
                onLog(`⚠️ Pay button still disabled, trying alternative selection...`);
                // Try clicking the entire invoice card area
                await page.click('div:has(> p:has-text("Dhs"))').catch(() => {});
                await page.waitForTimeout(2000);
                
                // Check again
                const stillDisabled = await page.$eval(
                    'button:has-text("Payer")', 
                    btn => btn.disabled
                ).catch(() => true);
                
                if (stillDisabled) {
                    onLog(`⚠️ Pay button still disabled after 2 attempts`);
                } else {
                    onLog(`✅ Pay button enabled after alternative selection`);
                }
            } else {
                onLog(`✅ Pay button enabled, invoice properly selected`);
            }

            // ===== STEP 5: Click Payer =====
            onLog(`👆 Clicking Pay...`);
            const payBtn = await page.$('button:has-text("Payer"):not([disabled])');
            if (payBtn) {
                await payBtn.click();
                onLog(`✅ Pay button clicked, waiting for CMI redirect...`);
            } else {
                // Force click even if disabled
                await page.$eval('button:has-text("Payer")', btn => {
                    btn.disabled = false;
                    btn.click();
                }).catch(() => {});
                onLog(`⚠️ Pay forced (was disabled)`);
            }

            // ===== STEP 6: Wait up to 3 MINUTES for CMI URL =====
            const maxWait = 180000; // 3 minutes
            const startWait = Date.now();
            let lastLog = 0;
            
            while (Date.now() - startWait < maxWait) {
                // Check if we got CMI URL from response listener
                if (cmiUrl) break;
                
                // Check if page URL changed to CMI
                const currentUrl = page.url();
                if (currentUrl.includes('cmi.co.ma') || currentUrl.includes('attijari-payment')) {
                    cmiUrl = currentUrl;
                    onLog(`🎯 Page redirected to CMI: ${cmiUrl}`);
                    break;
                }
                
                // Check for new tabs/popups
                const pages = context.pages();
                for (const p of pages) {
                    const pUrl = p.url();
                    if (pUrl.includes('cmi.co.ma') || pUrl.includes('attijari-payment')) {
                        cmiUrl = pUrl;
                        onLog(`🎯 CMI opened in a new tab: ${cmiUrl}`);
                        break;
                    }
                }
                if (cmiUrl) break;
                
                // Log progress every 15 seconds
                const elapsed = Math.round((Date.now() - startWait) / 1000);
                if (elapsed - lastLog >= 15) {
                    onLog(`⏳ ${elapsed}s elapsed... URL: ${page.url().substring(0, 80)}`);
                    lastLog = elapsed;
                }
                
                await page.waitForTimeout(500);
            }

            if (cmiUrl) {
                onLog(`✅ CMI Gateway URL generated successfully!`);
                onLog(`🔗 ${cmiUrl}`);
                return cmiUrl;
            } else {
                onLog(`⚠️ 3 minutes timeout exceeded, falling back to standard Inwi page.`);
            }
        } catch (e) {
            onLog(`⚠️ Error during CMI resolution: ${e.message}`);
        } finally {
            if (page) await page.close().catch(() => {});
            if (browser) await browser.close().catch(() => {});
        }
        return 'https://inwi.ma/fr/paiement-facture/paiement';
    }

    async getPaymentUrl() {
        return this.fastPayUrl;
    }
}

module.exports = InwiScraper;
