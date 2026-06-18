const mongoose = require('mongoose');
const User = require('./models/User');
const Registration = require('./models/Registration');
require('dotenv').config();

async function checkRegs() {
    await mongoose.connect(process.env.MONGO_URI);
    
    const regs = await Registration.find({}).populate('userId');
    console.log(`Found ${regs.length} registrations.`);
    for (const reg of regs) {
        console.log(`Reg ID: ${reg._id}, Status: ${reg.status}`);
        if (reg.userId) {
            console.log(`  User: ${reg.userId.username}, Email: ${reg.userId.email || 'NO EMAIL'}`);
        } else {
            console.log(`  User: NOT FOUND`);
        }
    }
    
    process.exit(0);
}

checkRegs();
