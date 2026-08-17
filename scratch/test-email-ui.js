require('dotenv').config();
const { sendBillSummary } = require('./src/services/email-service');
const db = require('./src/db/database');

async function testEmail() {
    const bills = db.getBills({ status: 'unpaid' });
    console.log(`Sending email with ${bills.length} unpaid bills...`);
    const res = await sendBillSummary(bills, process.env.EMAIL_RECIPIENT || process.env.SMTP_USER);
    console.log(res);
}

testEmail();
