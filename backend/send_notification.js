const mongoose = require('mongoose');
const Notification = require('./models/Notification');
const Registration = require('./models/Registration');
require('dotenv').config();

async function sendNotif() {
    await mongoose.connect(process.env.MONGO_URI);
    
    const id = '6a3273c38a0e04b92475a99e';
    const reg = await Registration.findById(id);
    
    if (reg) {
        const formatMode = `${reg.format.toUpperCase()} ${reg.mode.toUpperCase()}`;
        await Notification.create({
            userId: reg.userId,
            title: 'Registration Approved!',
            message: `Your registration for the ${formatMode} tournament on ${reg.startDate} has been Approved. Get ready for battle!`,
            type: 'success'
        });
        console.log("Notification created successfully.");
    } else {
        console.log("Registration not found.");
    }
    
    process.exit(0);
}

sendNotif();
