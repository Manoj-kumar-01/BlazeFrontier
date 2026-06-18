const mongoose = require('mongoose');
require('dotenv').config();

async function checkJobs() {
    await mongoose.connect(process.env.MONGO_URI);
    const db = mongoose.connection.db;
    const jobs = await db.collection('agendaJobs').find({ name: 'send-email' }).toArray();
    
    console.log(`Found ${jobs.length} send-email jobs.`);
    jobs.forEach(j => {
        console.log(`Job ID: ${j._id}, Status: ${j.lockedAt ? 'Locked' : 'Not Locked'}, NextRunAt: ${j.nextRunAt}, FailedAt: ${j.failedAt}, FailReason: ${j.failReason}`);
    });
    
    process.exit(0);
}

checkJobs();
