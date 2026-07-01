require('dotenv').config();
const mongoose = require('mongoose');
mongoose.connect(process.env.MONGO_URI).then(async () => {
    const User = require('./models/User');
    const PushSubscription = require('./models/PushSubscription');
    
    const subs = await PushSubscription.find();
    console.log('--- PUSH SUBSCRIPTIONS ---');
    console.log(`Found ${subs.length} subscriptions`);
    for (const sub of subs) {
        console.log(`User ID: ${sub.userId}, Endpoint: ${sub.endpoint.substring(0, 50)}...`);
    }

    const users = await User.find({}, 'username email inGameName matchmakingDailyCount');
    console.log('\n--- USERS DAILY LIMITS ---');
    for (const u of users) {
        console.log(`${u.username} (${u.email}) - DailyCount: ${u.matchmakingDailyCount}`);
    }

    process.exit(0);
});
