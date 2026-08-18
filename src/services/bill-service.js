const SrmCsScraper = require('../scrapers/srm-cs');
const InwiScraper = require('../scrapers/inwi');
const db = require('../db/database');

const getScraperInstance = (providerName) => {
    switch(providerName.toLowerCase()) {
        case 'srm-cs':
        case 'lydec':
            return new SrmCsScraper();
        case 'inwi':
            return new InwiScraper();
        default:
            throw new Error(`Unknown provider: ${providerName}`);
    }
};

const processScraperResult = async (result) => {
    // Log the scrape execution
    await db.logScrape({
        provider: result.provider,
        success: result.success,
        error_message: result.error_message,
        screenshot_path: result.screenshot_path,
        duration_ms: result.duration_ms
    });

    if (result.success && result.bills && result.bills.length > 0) {
        for (const bill of result.bills) {
            // Generate durable CMI link directly during scrape
            console.log(`[Durable Process] Generating CMI link for ${bill.provider} bill...`);
            try {
                const cmiUrl = await module.exports.resolveCmiLink(result.provider, () => {});
                if (cmiUrl) {
                    bill.payment_url = cmiUrl;
                    console.log(`[Durable Process] Successfully attached CMI link for ${bill.provider}`);
                }
            } catch (err) {
                console.error(`[Durable Process] Failed to generate CMI link for ${bill.provider}:`, err.message);
                bill.payment_url_error = err.message; // Optional tracking
            }
            await db.insertBill(bill);
        }
    }
};

const checkAllBills = async () => {
    const scrapers = [new SrmCsScraper(), new InwiScraper()];
    const results = [];

    for (const scraper of scrapers) {
        console.log(`Starting scraper for ${scraper.name}...`);
        try {
            const result = await scraper.checkBills();
            await processScraperResult(result);
            results.push(result);
        } catch (error) {
            console.error(`Unexpected error running scraper ${scraper.name}:`, error);
            const errResult = {
                provider: scraper.name,
                success: false,
                error_message: error.message,
                duration_ms: 0
            };
            await processScraperResult(errResult);
            results.push(errResult);
        }
    }

    return results;
};

const checkProvider = async (providerName) => {
    const scraper = getScraperInstance(providerName);
    try {
        const result = await scraper.checkBills();
        await processScraperResult(result);
        return result;
    } catch (error) {
        console.error(`Unexpected error running scraper ${providerName}:`, error);
        const errResult = {
            provider: providerName,
            success: false,
            error_message: error.message,
            duration_ms: 0
        };
        await processScraperResult(errResult);
        return errResult;
    }
};

const getBillSummary = async () => {
    const currentBills = await db.getCurrentBills();
    let totalAmount = 0;
    const unpaidBills = [];

    // Map provider names to the template keys
    const billsByType = {
        water: null,
        electricity: null,
        internet: null
    };

    currentBills.forEach(bill => {
        if (bill.status === 'unpaid') {
            totalAmount += bill.amount;
            unpaidBills.push(bill);
        }

        // Map provider to type
        const p = (bill.provider || '').toLowerCase();
        if (p.includes('water') || p === 'srm-cs-water') {
            billsByType.water = bill;
        } else if (p.includes('elec') || p === 'srm-cs-electricity') {
            billsByType.electricity = bill;
        } else if (p.includes('inwi') || p === 'inwi') {
            billsByType.internet = bill;
        }
    });

    // Get latest errors
    const recentErrors = await db.getRecentErrors();
    const errors = recentErrors.filter(log => log.success === 0);

    // Get history (last 20 bills)
    const history = await db.getBills({ limit: 20 });

    return {
        bills: billsByType,
        unpaid: unpaidBills,
        totalAmount: totalAmount,
        history: history,
        errors: errors
    };
};

const markPaid = async (billId) => {
    await db.markBillPaid(billId);
    return { success: true, id: billId };
};

const getHistory = async (limit = 50) => {
    return await db.getBills({ limit });
};

const resolveCmiLink = async (providerName, onLog = console.log) => {
    const settingPhone = await db.getSetting('inwiPhone');
    const phoneNumber = settingPhone || process.env.INWI_PHONE_NUMBER;
    
    if (providerName.toLowerCase().includes('inwi')) {
        if (phoneNumber) {
            const scraper = new InwiScraper();
            const url = await scraper.resolveCmiPaymentLink(phoneNumber, onLog);
            return url;
        }
        return 'https://inwi.ma/fr/paiement-facture/paiement';
    } 
    
    if (providerName.toLowerCase().includes('srm-cs') || providerName.toLowerCase().includes('lydec')) {
        const scraper = new SrmCsScraper();
        const url = await scraper.resolveCmiPaymentLink(onLog);
        return url;
    }

    throw new Error(`Unsupported provider for CMI link generation: ${providerName}`);
};

module.exports = {
    checkAllBills,
    checkProvider,
    getBillSummary,
    markPaid,
    getHistory,
    resolveCmiLink
};
