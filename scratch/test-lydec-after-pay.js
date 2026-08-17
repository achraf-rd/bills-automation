const playwright = require('playwright');
require('dotenv').config();

async function testLydecCmi() {
    const browser = await playwright.chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
        await page.goto('https://client.lydec.ma/site/fr/web/guest/agence-en-ligne', { waitUntil: 'domcontentloaded' });
        
        await page.fill('#_58_login', 'ly123646');
        await page.fill('#_58_password', '2019tpli');
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
            page.click('input[value="Connexion"]')
        ]);

        await page.goto('https://client.lydec.ma/site/fr/web/lydec/paiement', { waitUntil: 'domcontentloaded' });
        
        await page.evaluate(() => {
            const cb = document.querySelector('table#thetable input[type="checkbox"]');
            if (cb) {
                cb.checked = true;
                if (typeof calculerTotal === 'function') calculerTotal();
            }
            const cond = document.getElementById('condition');
            if (cond) cond.checked = true;
        });

        // Click Payer (which is ControlerSelection())
        // Wait for the navigation it causes
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
            page.evaluate(() => {
                if (typeof ControlerSelection === 'function') ControlerSelection();
            })
        ]);
        
        await page.waitForTimeout(2000);
        console.log('Navigated to:', page.url());
        await page.screenshot({ path: 'scratch/lydec-after-pay-button.png' });
        
        // Dump the main content
        const body = await page.content();
        const fs = require('fs');
        fs.writeFileSync('scratch/lydec-after-pay.html', body);

    } catch (e) {
        console.error('Error:', e);
    } finally {
        await browser.close();
    }
}

testLydecCmi();
