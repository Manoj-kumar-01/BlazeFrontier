require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');

const seedBlazePoints = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/blazefrontier');

        console.log('Connected to DB');

        // Update users who have 0 or undefined blaze points
        const result = await User.updateMany(
            { $or: [{ blazePoints: 0 }, { blazePoints: { $exists: false } }] },
            { $set: { blazePoints: 10 } }
        );

        console.log(`Successfully updated ${result.modifiedCount} users to have 10 Blaze Points.`);
        
        mongoose.disconnect();
    } catch (e) {
        console.error('Error during migration:', e);
        process.exit(1);
    }
};

seedBlazePoints();
