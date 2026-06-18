require('dotenv').config();
const mongoose = require('mongoose');
const News = require('./models/News');
const Series = require('./models/Series');
const Tournament = require('./models/Tournament');

mongoose.connect(process.env.MONGO_URI).then(async () => {
    console.log("Connected to MongoDB");

    const newsCount = await News.countDocuments();
    if (newsCount === 0) {
        await News.insertMany([
            { tag: "ANNOUNCEMENT", tagClass: "announce", title: "Season 4 Global Championship Announced", date: "JUN 14, 2026" },
            { tag: "UPDATE", tagClass: "update", title: "Anti-Cheat Protocol v2.4 Deployed", date: "JUN 12, 2026" },
            { tag: "EVENT", tagClass: "event", title: "Double BP Weekend — All Arenas", date: "JUN 10, 2026" },
            { tag: "MAINTENANCE", tagClass: "maint", title: "Scheduled Server Maintenance — COD Arena", date: "JUN 08, 2026" }
        ]);
        console.log("News seeded");
    }

    const seriesCount = await Series.countDocuments();
    if (seriesCount === 0) {
        await Series.insertMany([
            { name: "Blaze Weekly Pro Scrims", game: "freefire", status: "ONGOING", prizePool: "10K BP" },
            { name: "Tactical League S2", game: "cod", status: "ONGOING", prizePool: "25K BP" },
            { name: "Underground Brawl", game: "minimilitia", status: "REGISTERING", prizePool: "5K BP" }
        ]);
        console.log("Series seeded");
    }
    
    process.exit(0);
});
