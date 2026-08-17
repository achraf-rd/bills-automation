const playwright = require('playwright');
require('dotenv').config();

async function testLydecCmi() {
    const browser = await playwright.chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    let cmiUrl = null;
    page.on('response', (response) => {
        const url = response.url();
        const headers = response.headers();
        
        if (url.includes('cmi.co.ma') || url.includes('cmi') || url.includes('payment') || url.includes('payzone') || url.includes('fatourati')) {
            console.log(`\n🎯 INTERCEPTED PAYMENT URL: ${url}`);
            cmiUrl = url;
        }
        
        if (headers['location'] && (headers['location'].includes('cmi') || headers['location'].includes('payment'))) {
            console.log(`\n🎯 INTERCEPTED PAYMENT REDIRECT: ${headers['location']}`);
            cmiUrl = headers['location'];
        }
    });

    try {
        console.log('1. Navigating to login...');
        await page.goto('https://client.lydec.ma/site/fr/web/guest/agence-en-ligne', { waitUntil: 'domcontentloaded' });
        
        console.log('2. Logging in...');
        await page.fill('#_58_login', 'ly123646');
        await page.fill('#_58_password', '2019tpli');
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
            page.click('input[value="Connexion"]')
        ]);

        console.log('3. Navigating to bills page...');
        await page.goto('https://client.lydec.ma/site/fr/web/lydec/paiement', { waitUntil: 'domcontentloaded' });
        
        console.log('4. Selecting invoice...');
        await page.evaluate(() => {
            const cb = document.querySelector('table#thetable input[type="checkbox"]');
            if (cb) {
                cb.checked = true;
                if (typeof calculerTotal === 'function') calculerTotal();
            }
            const cond = document.getElementById('condition');
            if (cond) cond.checked = true;
        });

        console.log('5. Clicking Payer (Step 1)...');
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
            page.evaluate(() => {
                if (typeof ControlerSelection === 'function') ControlerSelection();
            })
        ]);
        
        console.log('6. Submitting Confirmer (Step 2)...');
        // Just submit the form directly to avoid UI errors in executer()
        await page.evaluate(() => {
            const form = document.getElementById('formulaire');
            if (form) form.submit();
        });
        
        console.log('Submitted confirmation. Waiting for CMI redirect...');
        
        const maxWait = 15000;
        const start = Date.now();
        while (Date.now() - start < maxWait) {
            if (cmiUrl) break;
            
            const url = page.url();
            if (url.includes('cmi.co.ma') || url.includes('payment') || url.includes('payzone') || url.includes('fatourati')) {
                console.log(`\n🎯 PAGE REDIRECTED TO: ${url}`);
                cmiUrl = url;
                break;
            }
            await page.waitForTimeout(500);
        }
        
        if (!cmiUrl) {
            console.log('Current URL after wait:', page.url());
        }

    } catch (e) {
        console.error('Error:', e);
    } finally {
        await browser.close();
    }
}

testLydecCmi();
