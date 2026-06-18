const mongoose = require('mongoose');
require('dotenv').config();

async function unlock() {
    await mongoose.connect(process.env.MONGO_URI);
    const db = mongoose.connection.db;
    const result = await db.collection('agendaJobs').updateMany(
        { lockedAt: { $ne: null } },
        { $set: { lockedAt: null } }
    );
    console.log(`Unlocked ${result.modifiedCount} jobs.`);
    process.exit(0);
}

unlock();
