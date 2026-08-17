const cron = require('node-cron');
const billService = require('./bill-service');
const emailService = require('./email-service');
const db = require('../db/database');

let scheduledTask = null;
let nextRun = null;

const startScheduler = () => {
    const schedule = process.env.CRON_SCHEDULE || db.getSetting('cronExpression') || '0 9 1,16 * *'; // Default: 9 AM on 1st and 16th
    
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
                if ((summary.unpaid && summary.unpaid.length > 0) || (summary.errors && summary.errors.length > 0)) {
                    const recipient = process.env.EMAIL_RECIPIENT || db.getSetting('recipientEmail') || db.getSetting('senderEmail');
                    if (recipient) {
                        await emailService.sendBillSummary(summary.unpaid, summary.errors, recipient, true);
                    }
                    
                    const reportRecipient = db.getSetting('reportRecipientEmail');
                    if (reportRecipient) {
                        console.log(`[Cron] Sending secondary report to ${reportRecipient}`);
                        await emailService.sendBillSummary(summary.unpaid, summary.errors, reportRecipient, false);
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
    return "Scheduled based on: " + (process.env.CRON_SCHEDULE || db.getSetting('cronExpression') || '0 9 1,16 * *');
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
