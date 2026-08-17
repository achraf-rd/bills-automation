const nodemailer = require('nodemailer');
const { formatMAD } = require('../utils/helpers');
const db = require('../db/database');

const getTransporter = () => {
    const host = db.getSetting('smtpHost');
    const port = parseInt(db.getSetting('smtpPort')) || 587;
    const user = db.getSetting('senderEmail');
    const pass = db.getSetting('emailPassword');

    if (!host || !user || !pass) {
        throw new Error('Email configuration is missing in Settings. Please configure SMTP settings.');
    }

    return nodemailer.createTransport({
        host: host,
        port: port,
        secure: port === 465, // Use true for 465, false for 587
        auth: {
            user: user,
            pass: pass
        }
    });
};

const getProviderColor = (provider) => {
    const p = provider.toLowerCase();
    if (p.includes('srm') || p.includes('lydec') || p.includes('water')) return '#06b6d4';
    if (p.includes('inwi') || p.includes('internet')) return '#8b5cf6';
    if (p.includes('elec')) return '#f59e0b';
    return '#64748b';
};

const getProviderEmoji = (provider) => {
    const p = provider.toLowerCase();
    if (p.includes('srm') || p.includes('lydec')) return '💧⚡';
    if (p.includes('inwi')) return '🌐';
    return '📄';
};

const sendBillSummary = async (bills, errors = [], recipientEmail, includePayButton = true) => {
    if ((!bills || bills.length === 0) && (!errors || errors.length === 0)) {
        console.log('No bills or errors to send.');
        return { success: true, message: 'No bills or errors to send' };
    }

    const transporter = getTransporter();
    
    // Calculate total
    const total = bills.reduce((sum, bill) => sum + (bill.amount || 0), 0);
    const date = new Date();
    const month = date.toLocaleString('en-US', { month: 'long' });
    const year = date.getFullYear();

    const appUrl = process.env.APP_URL || 'http://localhost:3000';

    let htmlBody = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
    </head>
    <body style="margin: 0; padding: 0; background-color: #f4f4f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
        <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; margin-top: 20px; margin-bottom: 20px; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">
            <!-- Header -->
            <div style="text-align: center; padding: 30px 20px; background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%); color: white;">
                <h1 style="margin: 0; font-size: 28px; font-weight: 800; letter-spacing: -0.5px;">Bills Summary</h1>
                <p style="margin: 8px 0 0; color: #94a3b8; font-size: 16px;">${month} ${year}</p>
            </div>
            
            <div style="padding: 30px 20px;">
    `;

    bills.forEach(bill => {
        const color = getProviderColor(bill.provider);
        const emoji = getProviderEmoji(bill.provider);
        // Use the pre-generated durable CMI link if it exists, otherwise fallback to the dynamic resolver
        const payLink = bill.payment_url || `${appUrl}/pay/${encodeURIComponent(bill.provider)}/${bill.id}`;

        htmlBody += `
                <!-- Bill Item -->
                <div style="border: 1px solid #e2e8f0; border-radius: 10px; margin-bottom: 20px; overflow: hidden; background-color: #ffffff;">
                    <div style="background-color: ${color}15; border-bottom: 1px solid ${color}30; padding: 12px 20px; display: flex; align-items: center;">
                        <span style="font-size: 20px; margin-right: 10px;">${emoji}</span>
                        <h3 style="margin: 0; color: ${color}; font-size: 16px; font-weight: 700;">${bill.provider}</h3>
                    </div>
                    <div style="padding: 20px;">
                        <div style="margin-bottom: 15px;">
                            <h2 style="margin: 0; font-size: 32px; color: #0f172a; font-weight: 800;">${formatMAD(bill.amount)}</h2>
                        </div>
                        <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
                            <tr>
                                <td style="padding: 4px 0; color: #64748b; font-size: 14px; width: 40%;"><strong>Période</strong></td>
                                <td style="padding: 4px 0; color: #1e293b; font-size: 14px; text-align: right; font-weight: 500;">${bill.billing_period}</td>
                            </tr>
                            ${bill.due_date ? `
                            <tr>
                                <td style="padding: 4px 0; color: #64748b; font-size: 14px;"><strong>Date d'échéance</strong></td>
                                <td style="padding: 4px 0; color: #ef4444; font-size: 14px; text-align: right; font-weight: 500;">${bill.due_date}</td>
                            </tr>` : ''}
                        </table>
                        
                        ${includePayButton ? `
                        <div style="text-align: center;">
                            <a href="${payLink}" style="display: block; background-color: #0f172a; color: #ffffff; padding: 14px 24px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px; text-align: center; transition: all 0.2s;">Payer Maintenant ⚡</a>
                        </div>
                        ` : ''}
                    </div>
                </div>
        `;
    });

    if (errors && errors.length > 0) {
        htmlBody += `
                <!-- Errors -->
                <div style="margin-top: 30px; border: 1px solid #fecaca; border-radius: 10px; overflow: hidden; background-color: #fef2f2;">
                    <div style="background-color: #fee2e2; border-bottom: 1px solid #fecaca; padding: 12px 20px; display: flex; align-items: center;">
                        <span style="font-size: 20px; margin-right: 10px;">⚠️</span>
                        <h3 style="margin: 0; color: #991b1b; font-size: 16px; font-weight: 700;">Action Requise : Problèmes de connexion</h3>
                    </div>
                    <div style="padding: 20px;">
                        <p style="margin: 0 0 15px 0; color: #991b1b; font-size: 14px;">Les services suivants n'ont pas pu être vérifiés :</p>
                        <ul style="margin: 0; padding-left: 20px; color: #7f1d1d; font-size: 14px;">
        `;
        errors.forEach(err => {
            htmlBody += `<li style="margin-bottom: 8px;"><strong>${err.provider}</strong>: ${err.error_message || 'Erreur inconnue'}</li>`;
        });
        htmlBody += `
                        </ul>
                    </div>
                </div>
        `;
    }

    htmlBody += `
                <!-- Total -->
                <div style="margin-top: 30px; background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 20px;">
                    <table style="width: 100%; border-collapse: collapse;">
                        <tr>
                            <td style="color: #475569; font-size: 18px; font-weight: 600;">Total Outstanding</td>
                            <td style="color: #dc2626; font-size: 24px; font-weight: 800; text-align: right;">${formatMAD(total)}</td>
                        </tr>
                    </table>
                </div>
            </div>
            
            <!-- Footer -->
            <div style="text-align: center; padding: 20px; background-color: #f8fafc; border-top: 1px solid #e2e8f0; color: #94a3b8; font-size: 13px;">
                <p style="margin: 0;">Bills Automation 🤖</p>
                <p style="margin: 4px 0 0;"><a href="${appUrl}" style="color: #3b82f6; text-decoration: none;">View Dashboard</a></p>
            </div>
        </div>
    </body>
    </html>
    `;

    try {
        const sender = db.getSetting('senderEmail');
        const info = await transporter.sendMail({
            from: `"Bills Automation" <${sender}>`,
            to: recipientEmail,
            subject: `📋 Bills Summary — ${month} ${year} — ${formatMAD(total)}`,
            html: htmlBody
        });
        console.log('Email sent:', info.messageId);
        return { success: true, messageId: info.messageId };
    } catch (error) {
        console.error('Failed to send email:', error);
        return { success: false, error: error.message };
    }
};

const sendTestEmail = async () => {
    try {
        const transporter = getTransporter();
        const sender = db.getSetting('senderEmail');
        const recipient = db.getSetting('recipientEmail') || sender;

        if (!recipient) {
            throw new Error('Recipient email is missing in Settings.');
        }

        const info = await transporter.sendMail({
            from: `"Bills Automation Test" <${sender}>`,
            to: recipient,
            subject: 'Bills Automation - Test Email',
            text: 'Your email configuration is working properly.',
            html: '<b>Your email configuration is working properly.</b>'
        });
        return { success: true, messageId: info.messageId };
    } catch (error) {
        return { success: false, error: error.message };
    }
};

module.exports = {
    sendBillSummary,
    sendTestEmail,
    getTransporter
};
