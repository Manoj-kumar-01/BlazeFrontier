require('dotenv').config();
const mongoose = require('mongoose');
mongoose.connect(process.env.MONGO_URI).then(async () => {
    const PushSubscription = require('./models/PushSubscription');
    
    // Simulate what matchmaking does
    const requesterId = '6a450a872d4cd3171372f893';
    
    console.log('Query with $ne: string');
    const subs1 = await PushSubscription.find({ userId: { $ne: requesterId } });
    console.log(`Found: ${subs1.length}`);

    console.log('Query with $ne: ObjectId');
    const subs2 = await PushSubscription.find({ userId: { $ne: new mongoose.Types.ObjectId(requesterId) } });
    console.log(`Found: ${subs2.length}`);
    
    // What about finding a completely different ID?
    const otherId = '6a450a872d4cd3171372f800';
    console.log('Query with $ne: string (other ID)');
    const subs3 = await PushSubscription.find({ userId: { $ne: otherId } });
    console.log(`Found: ${subs3.length}`);

    process.exit(0);
});
