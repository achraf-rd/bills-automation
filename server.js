require('dotenv').config();
const express = require('express');
const path = require('path');
const db = require('./src/db/database');
const billService = require('./src/services/bill-service');
const emailService = require('./src/services/email-service');
const scheduler = require('./src/services/scheduler');

const app = express();
const PORT = process.env.PORT || 3000;

// Setup Express
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request Logging Middleware
app.use((req, res, next) => {
    console.log(`\n--- [${new Date().toISOString()}] ${req.method} ${req.url} ---`);
    if (Object.keys(req.body).length > 0) {
        console.log('Request Body:');
        console.dir(req.body, { depth: null, colors: true });
    }

    // Intercept res.json to log the response
    const originalJson = res.json;
    res.json = function(body) {
        console.log('Response JSON:');
        console.dir(body, { depth: null, colors: true });
        console.log('---------------------------------------------------\n');
        return originalJson.call(this, body);
    };
    next();
});

// Start Scheduler
scheduler.startScheduler();

// Routes
app.get('/', async (req, res) => {
    try {
        const summary = await billService.getBillSummary();
        const lastCheck = await db.getLastScrapeTime();
        const settings = await db.getAllSettings();
        
        res.render('dashboard', {
            bills: summary.bills,
            totalAmount: summary.totalAmount,
            lastCheck: lastCheck,
            settings: settings,
            history: summary.history || []
        });
    } catch (error) {
        console.error('Dashboard render error:', error);
        res.render('dashboard', {
            bills: { water: null, electricity: null, internet: null },
            totalAmount: 0,
            lastCheck: null,
            settings: {},
            history: []
        });
    }
});

app.get('/pay/:provider/:id', async (req, res) => {
    try {
        const provider = decodeURIComponent(req.params.provider);
        const billId = req.params.id;
        
        // Find the specific bill
        const bills = await db.getBills({ provider: provider });
        const bill = bills.find(b => b.id == billId);
        
        if (!bill) {
            return res.status(404).send('Bill not found or already paid.');
        }

        res.render('pay', { bill, provider });
    } catch (error) {
        res.status(500).send(error.message);
    }
});

app.get('/settings', async (req, res) => {
    try {
        const settings = await db.getAllSettings();
        res.render('settings', { settings });
    } catch (error) {
        res.status(500).send(error.message);
    }
});

app.post('/api/settings', async (req, res) => {
    try {
        await db.saveAllSettings(req.body);
        res.redirect('/settings');
    } catch (error) {
        res.status(500).send(error.message);
    }
});

app.post('/api/check-now', async (req, res) => {
    try {
        const results = await billService.checkAllBills();
        res.json({ success: true, results });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/check-provider/:provider', async (req, res) => {
    try {
        const result = await billService.checkProvider(req.params.provider);
        res.json({ success: true, result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/stream-cmi/:provider', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders && res.flushHeaders();

    const sendLog = (msg) => {
        const timestamp = new Date().toLocaleTimeString('en-US');
        res.write(`data: ${JSON.stringify({ log: `[${timestamp}] ${msg}` })}\n\n`);
    };

    try {
        sendLog('⚡ Connecting to CMI service...');
        const url = await billService.resolveCmiLink(req.params.provider, sendLog);
        res.write(`data: ${JSON.stringify({ complete: true, url })}\n\n`);
    } catch (error) {
        sendLog(`❌ Error: ${error.message}`);
        res.write(`data: ${JSON.stringify({ complete: true, error: error.message })}\n\n`);
    } finally {
        res.end();
    }
});

app.post('/api/get-cmi-link/:provider', async (req, res) => {
    try {
        const url = await billService.resolveCmiLink(req.params.provider);
        res.json({ success: true, url });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/send-email', async (req, res) => {
    try {
        const summary = await billService.getBillSummary();
        const recipientEmail = await db.getSetting('recipientEmail');
        const senderEmail = await db.getSetting('senderEmail');
        const recipient = recipientEmail || senderEmail;
        
        if (!recipient) {
            return res.status(400).json({ success: false, error: 'No recipient email configured in settings.' });
        }
        
        const result = await emailService.sendBillSummary(summary.unpaid, summary.errors, recipient);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/mark-paid/:id', async (req, res) => {
    try {
        const result = await billService.markPaid(req.params.id);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/bills', async (req, res) => {
    try {
        const filters = {
            provider: req.query.provider,
            status: req.query.status
        };
        const bills = await db.getBills(filters);
        res.json(bills);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/history', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        const history = await db.getBills({ limit });
        res.json(history);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Start Server
app.listen(PORT, () => {
    console.log(`Server started. Dashboard available at http://localhost:${PORT}`);
    console.log(`Scheduler status: ${scheduler.isRunning() ? 'Running' : 'Stopped'}`);
});
