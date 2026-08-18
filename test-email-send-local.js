require('dotenv').config();
const db = require('./src/db/database');
const emailService = require('./src/services/email-service');

const run = async () => {
    try {
        console.log('Connecting to db (mongoose already running)...');
        // Give mongoose a moment to connect if necessary
        await new Promise(r => setTimeout(r, 1000));
        
        console.log('Fetching settings...');
        const settings = await db.getAllSettings();
        console.log('Settings:', settings);
        
        console.log('Testing email...');
        const result = await emailService.sendTestEmail();
        console.log('Email test result:', result);
    } catch (e) {
        console.error('Error:', e);
    } finally {
        process.exit();
    }
};

run();
