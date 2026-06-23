const nodemailer = require('nodemailer');
const fs = require('fs');

const sendEmail = async (options) => {
    try {
        console.log(`[Mailer] Attempting to send email. User: ${process.env.EMAIL_USER}`);

        // 1. BREVO API (Recommended for Render - Bypasses SMTP blocks)
        if (process.env.BREVO_API_KEY) {
            console.log(`[Mailer] Using Brevo HTTP API`);
            
            let apiAttachments = undefined;
            if (options.attachments && options.attachments.length > 0) {
                apiAttachments = options.attachments.map(att => {
                    let content = '';
                    if (att.path && fs.existsSync(att.path)) {
                        content = fs.readFileSync(att.path).toString('base64');
                    }
                    return {
                        name: att.filename,
                        content: content
                    };
                });
            }

            const response = await fetch('https://api.brevo.com/v3/smtp/email', {
                method: 'POST',
                headers: {
                    'accept': 'application/json',
                    'api-key': process.env.BREVO_API_KEY,
                    'content-type': 'application/json'
                },
                body: JSON.stringify({
                    sender: { name: 'Blaze Frontier', email: process.env.EMAIL_USER },
                    to: [{ email: options.email }],
                    subject: options.subject,
                    htmlContent: options.html || options.message,
                    attachment: apiAttachments
                })
            });

            if (!response.ok) {
                const errData = await response.text();
                throw new Error(`Brevo API Error: ${errData}`);
            }

            console.log(`Email sent via Brevo API successfully.`);
            return true;
        }
        
        // 2. RESEND API (Alternative)
        if (process.env.RESEND_API_KEY) {
            console.log(`[Mailer] Using Resend HTTP API`);
            
            let apiAttachments = undefined;
            if (options.attachments && options.attachments.length > 0) {
                apiAttachments = options.attachments.map(att => {
                    let content = '';
                    if (att.path && fs.existsSync(att.path)) {
                        content = fs.readFileSync(att.path).toString('base64');
                    }
                    return {
                        filename: att.filename,
                        content: content
                    };
                });
            }

            const response = await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    from: `Blaze Frontier <${process.env.EMAIL_USER}>`, 
                    to: options.email,
                    subject: options.subject,
                    html: options.html || options.message,
                    attachments: apiAttachments
                })
            });

            if (!response.ok) {
                const errData = await response.text();
                throw new Error(`Resend API Error: ${errData}`);
            }

            console.log(`Email sent via Resend API successfully.`);
            return true;
        }

        // 3. DEFAULT: Nodemailer SMTP (Works locally, but blocked by Render)
        console.log(`[Mailer] Using Nodemailer SMTP`);
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS
            },
            connectionTimeout: 10000,
            socketTimeout: 10000
        });

        const mailOptions = {
            from: `Blaze Frontier <${process.env.EMAIL_USER}>`,
            to: options.email,
            subject: options.subject,
            html: options.html || options.message,
            attachments: options.attachments || []
        };

        const info = await transporter.sendMail(mailOptions);
        console.log(`Email sent: ${info.response}`);
        return true;

    } catch (err) {
        console.error('Error sending email:', err.message);
        return false;
    }
};

module.exports = sendEmail;
