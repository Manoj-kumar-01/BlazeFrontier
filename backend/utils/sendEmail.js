const nodemailer = require('nodemailer');

const sendEmail = async (options) => {
    try {
        console.log(`[Mailer] Attempting to send email. User: ${process.env.EMAIL_USER}`);
        // Create a transporter using standard SMTP
        const transporter = nodemailer.createTransport({
            service: 'gmail', // You can change this to another provider if needed
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS // Make sure to define EMAIL_PASS in your .env file
            },
            connectionTimeout: 10000, // 10 seconds timeout
            socketTimeout: 10000
        });

        // Define email options
        const mailOptions = {
            from: `Blaze Frontier <${process.env.EMAIL_USER}>`,
            to: options.email,
            subject: options.subject,
            html: options.html || options.message, // Fallback to text message if no HTML provided
            attachments: options.attachments || []
        };

        // Send email
        const info = await transporter.sendMail(mailOptions);
        console.log(`Email sent: ${info.response}`);
        return true;
    } catch (err) {
        console.error('Error sending email:', err.message);
        // We do not throw the error to prevent the main registration flow from crashing if email fails.
        return false;
    }
};

module.exports = sendEmail;
