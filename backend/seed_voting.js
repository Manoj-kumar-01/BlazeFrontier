 const mongoose = require('mongoose');
require('dotenv').config();

const ClipSubmission = require('./models/ClipSubmission');
const VotingEvent = require('./models/VotingEvent');
const User = require('./models/User');

async function seed() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        const db = mongoose.connection.useDb('test'); // Or default
        console.log('Connected to DB');

        // Find a random user to attribute clips to
        const user = await User.findOne({});
        if (!user) {
            console.log("No user found. Please register at least one user.");
            process.exit(1);
        }

        // Deactivate old events
        await VotingEvent.updateMany({}, { isActive: false });

        // Create 3 dummy clips
        const clipsData = [
            {
                userId: user._id,
                playerId: 'BLZ-TEST1',
                game: 'Free Fire',
                title: 'Insane 1v4 Clutch',
                videoUrl: '/public/0617.mp4',
                status: 'Approved'
            },
            {
                userId: user._id,
                playerId: 'BLZ-TEST2',
                game: 'Free Fire',
                title: 'Crazy Sniper Headshot',
                videoUrl: '/public/potd_0617.mp4',
                status: 'Approved'
            },
            {
                userId: user._id,
                playerId: 'BLZ-TEST3',
                game: 'Free Fire',
                title: 'Last Zone Survival',
                videoUrl: '/public/DesktopBG.mp4',
                status: 'Approved'
            }
        ];

        const insertedClips = await ClipSubmission.insertMany(clipsData);
        console.log('Inserted 3 dummy clips');

        // Create a new active voting event
        const newEvent = new VotingEvent({
            title: 'Weekly Best Clip - Free Fire',
            game: 'Free Fire',
            isActive: true,
            clips: insertedClips.map(c => c._id)
        });

        await newEvent.save();
        console.log('Voting Event seeded successfully!');
        
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

seed();
