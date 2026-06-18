const mongoose = require('mongoose');
const User = require('./models/User');
const Registration = require('./models/Registration');
const sendEmail = require('./utils/sendEmail');
require('dotenv').config();

async function sendNow() {
    await mongoose.connect(process.env.MONGO_URI);
    
    const id = '6a3273c38a0e04b92475a99e';
    const reg = await Registration.findById(id);
    const user = await User.findById(reg.userId);
    
    if (user && user.email) {
        console.log("Sending email directly to: ", user.email);
        const formatMode = `${reg.format.toUpperCase()} ${reg.mode.toUpperCase()}`;
        const result = await sendEmail({
            email: user.email,
            subject: 'Tournament Registration Approved! - Blaze Frontier',
            html: `
                <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; text-align: center; padding: 20px;">
                    <div style="margin-bottom: 30px;">
                        <img src="cid:tournamentposter" alt="Tournament Poster" style="max-width: 100%; border-radius: 8px; box-shadow: 0 4px 15px rgba(0,0,0,0.2);">
                    </div>
                    <p style="font-size: 1.1rem; line-height: 1.6; color: #333; margin-bottom: 25px;">
                        Your registration for the <strong>${formatMode}</strong> tournament on <strong>${reg.startDate}</strong> at <strong>${reg.timeSlot}</strong> has been officially confirmed.
                    </p>
                    <p style="color: #ff4e00; font-weight: bold; letter-spacing: 1px;">- THE BLAZE FRONTIER COMMAND -</p>
                </div>
            `,
            attachments: [
                {
                    filename: 'tournament_poster.png',
                    path: require('path').join(__dirname, '../public/tournament_poster.png'),
                    cid: 'tournamentposter'
                }
            ]
        });
        if (result) {
            console.log("Email sent successfully!");
        } else {
            console.log("Failed to send email.");
        }
    }
    
    process.exit(0);
}

sendNow();
