const cron = require('node-cron');
const billService = require('./bill-service');
const emailService = require('./email-service');
const db = require('../db/database');

let scheduledTask = null;
let nextRun = null;

const startScheduler = () => {
    const schedule = process.env.CRON_SCHEDULE || '0 9 * * *'; // Default: every day at 9 AM
    
    if (scheduledTask) {
        scheduledTask.stop();
    }

    console.log(`Starting scheduler with schedule: ${schedule}`);
    
    scheduledTask = cron.schedule(schedule, async () => {
        console.log(`[Cron] Executing scheduled bill check at ${new Date().toISOString()}`);
        
        try {
            const results = await billService.checkAllBills();
            
            const autoSend = process.env.AUTO_SEND_EMAIL === 'true' || db.getSetting('auto_send_email') === 'true';
            
            if (autoSend) {
                const summary = await billService.getBillSummary();
                if (summary.unpaid && summary.unpaid.length > 0) {
                    const recipient = process.env.EMAIL_RECIPIENT;
                    if (recipient) {
                        await emailService.sendBillSummary(summary.unpaid, recipient);
                    }
                }
            }
            
            // Calculate next run manually since node-cron doesn't expose it easily
            // For now, just logging completion
            console.log('[Cron] Execution completed successfully.');
        } catch (error) {
            console.error('[Cron] Error during scheduled execution:', error);
        }
    });
};

const stopScheduler = () => {
    if (scheduledTask) {
        scheduledTask.stop();
        scheduledTask = null;
        console.log('Scheduler stopped.');
    }
};

const getNextRun = () => {
    // node-cron doesn't easily expose the next run time natively without additional parsing.
    // Return a placeholder or implement cron-parser for accurate time.
    return "Scheduled based on: " + (process.env.CRON_SCHEDULE || '0 9 * * *');
};

const isRunning = () => {
    return scheduledTask !== null;
};

module.exports = {
    startScheduler,
    stopScheduler,
    getNextRun,
    isRunning
};
