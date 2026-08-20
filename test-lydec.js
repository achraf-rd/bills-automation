const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto('https://client.lydec.ma/site/fr/web/guest/agence-en-ligne', { waitUntil: 'domcontentloaded', timeout: 30000 });
    
    console.log('Title:', await page.title());
    
    const html = await page.content();
    fs.writeFileSync('C:\\Users\\pc\\.gemini\\antigravity\\brain\\e06ee9c6-ee0a-4493-9caa-8d49abe36b60\\scratch\\lydec-login-test.html', html);
    
    const loginExists = !!(await page.$('#_58_login'));
    console.log('#_58_login exists:', loginExists);
    
    await browser.close();
})();
