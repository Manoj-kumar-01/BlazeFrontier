const mongoose = require('mongoose');
const dotenv = require('dotenv');
const bcrypt = require('bcryptjs');
const User = require('./models/User');
const Tournament = require('./models/Tournament');
const Clip = require('./models/Clip');

dotenv.config();

const seedDB = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to MongoDB for Seeding');

        // Clear existing mock data (except users we want to keep, but for safety let's clear clips/tournaments)
        await Tournament.deleteMany();
        await Clip.deleteMany();

        // Seed Tournaments
        const tournaments = [
            { name: "BLAZE WEEKLY SHOWDOWN", game: "freefire", prize: "Free Entry", status: "Open", date: "OCTOBER 15, 2026", participants: "48/100" },
            { name: "CODM REGIONAL CLASH", game: "cod", prize: "Free Entry", status: "Open", date: "OCTOBER 18, 2026", participants: "12/50" },
            { name: "MILITIA ELITE CUP", game: "minimilitia", prize: "Free Entry", status: "Closed", date: "OCTOBER 13, 2026", participants: "32/32" }
        ];
        await Tournament.insertMany(tournaments);
        console.log('Tournaments Seeded');

        // Seed Clips
        const clips = [
            { title: "Insane 1v4 Clutch Setup", author: "RocketKing", game: "minimilitia", views: "12K", thumbnail: "../public/mm_bg.png" },
            { title: "Final Zone Domination", author: "SargeDestroyer", game: "freefire", views: "8.5K", thumbnail: "../public/ff_bg.png" },
            { title: "Sniper God Montage", author: "GhostRecon", game: "cod", views: "24K", thumbnail: "../public/cod_bg.png" },
            { title: "Crazy Grenade Bounce", author: "CommanderX", game: "minimilitia", views: "4.2K", thumbnail: "../public/mm_bg.png" },
        ];
        await Clip.insertMany(clips);
        console.log('Clips Seeded');

        // Check if we need to seed some dummy users for the leaderboard
        const userCount = await User.countDocuments();
        if (userCount < 5) {
            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash('password123', salt);
            
            const dummyUsers = [
                { playerId: "BLZ-AA111", username: "SARGEDESTROYER", password: hashedPassword, tier: "GENERAL", tourneysWon: 14, reputation: 10200 },
                { playerId: "BLZ-BB222", username: "ROCKETKING", password: hashedPassword, tier: "MAJOR", tourneysWon: 8, reputation: 8450 },
                { playerId: "BLZ-CC333", username: "GHOST_RECON", password: hashedPassword, tier: "COLONEL", tourneysWon: 5, reputation: 7800 },
                { playerId: "BLZ-DD444", username: "CYBER_NINJA", password: hashedPassword, tier: "CAPTAIN", tourneysWon: 3, reputation: 6900 },
                { playerId: "BLZ-EE555", username: "IRON_STORM", password: hashedPassword, tier: "CAPTAIN", tourneysWon: 2, reputation: 6500 }
            ];
            await User.insertMany(dummyUsers);
            console.log('Dummy Users Seeded for Leaderboard');
        }

        console.log('Database Seeding Complete!');
        process.exit();
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
};

seedDB();
