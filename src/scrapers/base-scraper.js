const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { slugify } = require('../utils/helpers');

class BaseScraper {
    constructor(name) {
        this.name = name;
        this.browser = null;
        this.context = null;
        this.page = null;
    }

    async launch() {
        const isHeadless = process.env.BROWSER_HEADLESS !== 'false';
        this.browser = await chromium.launch({
            headless: isHeadless,
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox',
                '--disable-blink-features=AutomationControlled'
            ]
        });
        this.context = await this.browser.newContext({
            viewport: { width: 1366, height: 768 },
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
        });
        await this.context.addInitScript(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        });
    }

    async newPage() {
        if (!this.context) await this.launch();
        this.page = await this.context.newPage();
        this.page.setDefaultTimeout(30000); // 30 seconds default
        return this.page;
    }

    async screenshotOnError(page, error) {
        try {
            const screenshotsDir = path.join(__dirname, '..', '..', 'screenshots');
            if (!fs.existsSync(screenshotsDir)) {
                fs.mkdirSync(screenshotsDir, { recursive: true });
            }
            
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const filename = `${slugify(this.name)}-error-${timestamp}.png`;
            const filepath = path.join(screenshotsDir, filename);
            
            await page.screenshot({ path: filepath, fullPage: true });
            console.error(`[${this.name}] Scraper error screenshot saved to ${filepath}`);
            return filepath;
        } catch (e) {
            console.error(`[${this.name}] Failed to take error screenshot:`, e);
            return null;
        }
    }

    async close() {
        if (this.context) await this.context.close();
        if (this.browser) await this.browser.close();
        this.page = null;
        this.context = null;
        this.browser = null;
    }

    async waitAndClick(page, selector, options = {}) {
        await page.waitForSelector(selector, { state: 'visible', ...options });
        await page.click(selector, options);
    }

    async waitAndType(page, selector, text, options = {}) {
        await page.waitForSelector(selector, { state: 'visible', ...options });
        await page.fill(selector, text, options);
    }

    async waitForNavigation(page, options = {}) {
        await page.waitForNavigation({ waitUntil: 'networkidle', ...options });
    }
}

module.exports = BaseScraper;
