const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '..', '..', 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'bills.db');
const db = new Database(dbPath);

// Initialize tables
db.exec(`
    CREATE TABLE IF NOT EXISTS bills (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider TEXT NOT NULL,
        invoice_number TEXT,
        amount REAL NOT NULL,
        billing_period TEXT,
        consumption TEXT,
        due_date TEXT,
        payment_url TEXT,
        payment_code TEXT,
        status TEXT DEFAULT 'unpaid',
        pdf_path TEXT,
        raw_data TEXT,
        scraped_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(provider, billing_period)
    );
    CREATE TABLE IF NOT EXISTS scrape_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider TEXT NOT NULL,
        success INTEGER NOT NULL,
        error_message TEXT,
        screenshot_path TEXT,
        duration_ms INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );
`);

const insertBill = (billData) => {
    const stmt = db.prepare(`
        INSERT INTO bills (
            provider, invoice_number, amount, billing_period, 
            consumption, due_date, payment_url, payment_code, status, pdf_path, raw_data
        ) VALUES (
            @provider, @invoice_number, @amount, @billing_period,
            @consumption, @due_date, @payment_url, @payment_code, @status, @pdf_path, @raw_data
        )
        ON CONFLICT(provider, billing_period) DO UPDATE SET
            invoice_number = excluded.invoice_number,
            amount = excluded.amount,
            consumption = excluded.consumption,
            due_date = excluded.due_date,
            payment_url = excluded.payment_url,
            payment_code = excluded.payment_code,
            status = excluded.status,
            pdf_path = excluded.pdf_path,
            raw_data = excluded.raw_data,
            scraped_at = CURRENT_TIMESTAMP
    `);
    
    return stmt.run({
        provider: billData.provider,
        invoice_number: billData.invoice_number || null,
        amount: billData.amount,
        billing_period: billData.billing_period,
        consumption: billData.consumption || null,
        due_date: billData.due_date || null,
        payment_url: billData.payment_url || null,
        payment_code: billData.payment_code || null,
        status: billData.status || 'unpaid',
        pdf_path: billData.pdf_path || null,
        raw_data: billData.raw_data ? JSON.stringify(billData.raw_data) : null
    });
};

const getBills = (filters = {}) => {
    let query = 'SELECT * FROM bills WHERE 1=1';
    const params = [];

    if (filters.provider) {
        query += ' AND provider = ?';
        params.push(filters.provider);
    }
    if (filters.status) {
        query += ' AND status = ?';
        params.push(filters.status);
    }
    
    query += ' ORDER BY scraped_at DESC';
    
    if (filters.limit) {
        query += ' LIMIT ?';
        params.push(filters.limit);
    }

    return db.prepare(query).all(...params);
};

const getCurrentBills = () => {
    // Get the most recent bill per provider
    const query = `
        SELECT b1.* FROM bills b1
        INNER JOIN (
            SELECT provider, MAX(scraped_at) as max_scraped
            FROM bills
            GROUP BY provider
        ) b2 ON b1.provider = b2.provider AND b1.scraped_at = b2.max_scraped
    `;
    return db.prepare(query).all();
};

const getBillById = (id) => {
    return db.prepare('SELECT * FROM bills WHERE id = ?').get(id);
};

const markBillPaid = (id) => {
    return db.prepare("UPDATE bills SET status = 'paid' WHERE id = ?").run(id);
};

const getUnpaidBills = () => {
    return db.prepare("SELECT * FROM bills WHERE status = 'unpaid' ORDER BY due_date ASC").all();
};

const logScrape = (logData) => {
    const stmt = db.prepare(`
        INSERT INTO scrape_logs (provider, success, error_message, screenshot_path, duration_ms)
        VALUES (@provider, @success, @error_message, @screenshot_path, @duration_ms)
    `);
    return stmt.run({
        provider: logData.provider,
        success: logData.success ? 1 : 0,
        error_message: logData.error_message || null,
        screenshot_path: logData.screenshot_path || null,
        duration_ms: logData.duration_ms || 0
    });
};

const getLastScrapeTime = () => {
    const row = db.prepare("SELECT MAX(created_at) as last_scrape FROM scrape_logs WHERE success = 1").get();
    return row ? row.last_scrape : null;
};

const getRecentErrors = () => {
    return db.prepare(`
        SELECT provider, success, error_message, created_at 
        FROM scrape_logs 
        WHERE id IN (
            SELECT MAX(id) FROM scrape_logs GROUP BY provider
        )
    `).all();
};

const getSetting = (key) => {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? row.value : null;
};

const setSetting = (key, value) => {
    return db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
};

const getAllSettings = () => {
    const rows = db.prepare('SELECT * FROM settings').all();
    const settings = {};
    rows.forEach(row => {
        settings[row.key] = row.value;
    });
    return settings;
};

const saveAllSettings = (settingsObj) => {
    const insert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    const saveMany = db.transaction((settings) => {
        for (const [key, value] of Object.entries(settings)) {
            insert.run(key, String(value));
        }
    });
    saveMany(settingsObj);
};

module.exports = {
    insertBill,
    getBills,
    getCurrentBills,
    getBillById,
    markBillPaid,
    getUnpaidBills,
    logScrape,
    getLastScrapeTime,
    getRecentErrors,
    getSetting,
    setSetting,
    getAllSettings,
    saveAllSettings
};
