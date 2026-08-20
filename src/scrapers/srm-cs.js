const BaseScraper = require('./base-scraper');
const { getCurrentBillingPeriod } = require('../utils/helpers');

class SrmCsScraper extends BaseScraper {
    constructor() {
        super('SRM-CS');
        this.loginUrl = 'https://client.lydec.ma/site/fr/web/guest/agence-en-ligne';
        this.billsUrl = 'https://client.lydec.ma/site/fr/web/lydec/paiement';
        this.paymentUrl = 'https://client.lydec.ma/site/fr/web/lydec/paiement';
    }

    async checkBills() {
        const db = require('../db/database');
        const username = (await db.getSetting('srmUsername')) || process.env.SRMCS_USERNAME;
        const password = (await db.getSetting('srmPassword')) || process.env.SRMCS_PASSWORD;
        
        if (!username || !password) {
            throw new Error('SRMCS credentials (username or password) not configured in environment or settings.');
        }

        const startTime = Date.now();
        let page;
        
        try {
            console.log(`[${this.name}] Launching browser...`);
            page = await this.newPage();
            
            console.log(`[${this.name}] Navigating to login page...`);
            await page.goto(this.loginUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
            
            // Fill login form
            console.log(`[${this.name}] Filling credentials...`);
            await page.waitForSelector('#_58_login', { timeout: 30000 });
            await page.fill('#_58_login', username);
            await page.fill('#_58_password', password);
            
            // Click login
            console.log(`[${this.name}] Clicking login...`);
            await Promise.all([
                page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }),
                page.click('input.aui-button-input-submit, input[value="Connexion"]')
            ]);
            
            console.log(`[${this.name}] Logged in successfully. Current URL: ${page.url()}`);
            
            // The user says there is a link to "Réglez vos factures"
            console.log(`[${this.name}] Navigating to bills page...`);
            await page.goto(this.billsUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
            
            console.log(`[${this.name}] Scraping bills...`);
            await page.waitForSelector('table#thetable', { timeout: 15000 }).catch(() => {});
            
            // Evaluate page content to find unpaid invoices
            const bills = await page.evaluate((providerName) => {
                const results = [];
                const rows = document.querySelectorAll('table#thetable tbody tr.tdalt1');
                
                for (const row of rows) {
                    const cells = row.querySelectorAll('td');
                    if (cells.length >= 8) {
                        const invoiceNum = cells[0].innerText.trim();
                        const contractNum = cells[2].innerText.trim();
                        const dueDate = cells[4].innerText.trim();
                        const amountText = cells[6].innerText.trim();
                        
                        const amount = parseFloat(amountText.replace(',', '.'));
                        
                        if (amount > 0) {
                            results.push({
                                provider: providerName + '-Water', // Map to water card for now
                                invoice_number: invoiceNum,
                                amount: amount,
                                due_date: dueDate,
                                consumption: contractNum, // Store contract num in consumption field for now
                                billing_period: dueDate, // Use due date as period identifier if no explicit period
                                status: 'unpaid',
                                raw_data: { 
                                    contract: contractNum,
                                    invoice: invoiceNum 
                                }
                            });
                        }
                    }
                }
                
                return results;
            }, this.name);
            
            // Add payment URL to found bills
            for (const bill of bills) {
                bill.payment_url = this.paymentUrl; // Later we can add a specific direct payment link generator if needed
            }
            
            return {
                provider: this.name,
                success: true,
                bills: bills,
                duration_ms: Date.now() - startTime
            };
            
        } catch (error) {
            console.error(`[${this.name}] Scraping failed:`, error.message);
            let screenshotPath = null;
            if (page) {
                screenshotPath = await this.screenshotOnError(page, error);
            }
            
            return {
                provider: this.name,
                success: false,
                error_message: error.message,
                screenshot_path: screenshotPath,
                duration_ms: Date.now() - startTime
            };
        } finally {
            await this.close();
        }
    }

    async getPaymentUrl() {
        return this.paymentUrl;
    }

    async resolveCmiPaymentLink(onLog = console.log) {
        const db = require('../db/database');
        const username = (await db.getSetting('srmUsername')) || process.env.SRMCS_USERNAME;
        const password = (await db.getSetting('srmPassword')) || process.env.SRMCS_PASSWORD;
        
        if (!username || !password) {
            throw new Error('SRMCS credentials missing. Cannot generate CMI link.');
        }

        let page;
        let cmiUrl = null;

        try {
            onLog('🌐 Launching headless browser for Lydec...');
            page = await this.newPage();

            page.on('response', (response) => {
                const url = response.url();
                const headers = response.headers();
                
                if (url.includes('cmi.co.ma') || url.includes('payment') || url.includes('fatourati')) {
                    onLog(`🎯 Intercepted direct payment URL: ${url}`);
                    cmiUrl = url;
                }
                if (headers['location'] && (headers['location'].includes('cmi.co.ma') || headers['location'].includes('payment'))) {
                    onLog(`🎯 Intercepted payment redirect: ${headers['location']}`);
                    cmiUrl = headers['location'];
                }
            });

            onLog('🔑 Navigating to Lydec portal...');
            await page.goto(this.loginUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
            
            onLog('👤 Logging in...');
            await page.fill('#_58_login', username);
            await page.fill('#_58_password', password);
            await Promise.all([
                page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }),
                page.click('input.aui-button-input-submit, input[value="Connexion"]')
            ]);

            onLog('📄 Accessing bills page...');
            await page.goto(this.billsUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
            
            onLog('✅ Selecting unpaid bills and accepting conditions...');
            await page.evaluate(() => {
                const cb = document.querySelector('table#thetable input[type="checkbox"]');
                if (cb) {
                    cb.checked = true;
                    if (typeof calculerTotal === 'function') calculerTotal();
                }
                const cond = document.getElementById('condition');
                if (cond) cond.checked = true;
            });

            onLog('💳 Clicking Payer (Step 1)...');
            await Promise.all([
                page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }),
                page.evaluate(() => {
                    if (typeof ControlerSelection === 'function') ControlerSelection();
                })
            ]);
            
            onLog('✔️ Submitting confirmation (Step 2)...');
            await page.evaluate(() => {
                const form = document.getElementById('formulaire');
                if (form) form.submit();
            });
            
            onLog('⏳ Waiting for CMI gateway redirect...');
            const maxWait = 20000;
            const start = Date.now();
            while (Date.now() - start < maxWait) {
                if (cmiUrl) break;
                const url = page.url();
                if (url.includes('cmi.co.ma') || url.includes('payment')) {
                    cmiUrl = url;
                    break;
                }
                await page.waitForTimeout(500);
            }

            if (!cmiUrl) {
                onLog('⚠️ Timed out waiting for CMI link.');
                const screenshotPath = await this.screenshotOnError(page, new Error('CMI Timeout'));
                onLog(`📸 Saved debug screenshot to ${screenshotPath}`);
                throw new Error('Failed to extract CMI link.');
            }

            onLog('✨ CMI link extraction successful!');
            return cmiUrl;

        } catch (error) {
            onLog(`❌ Scraper Error: ${error.message}`);
            throw error;
        } finally {
            await this.close();
        }
    }
}

module.exports = SrmCsScraper;
