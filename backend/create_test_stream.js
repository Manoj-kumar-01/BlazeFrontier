const mongoose = require('mongoose');
require('dotenv').config();
const LiveStream = require('./models/LiveStream');

mongoose.connect(process.env.MONGO_URI)
.then(async () => {
    console.log('Connected to DB');

    // Create a YouTube stream
    const stream1 = new LiveStream({
        title: 'Free Fire Grand Finals',
        game: 'Free Fire',
        platform: 'YouTube',
        streamUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', // Using Rickroll as a placeholder
        status: 'LIVE'
    });

    // Create a Facebook stream
    const stream2 = new LiveStream({
        title: 'COD Mobile Pro Scrims',
        game: 'COD Mobile',
        platform: 'Facebook',
        streamUrl: 'https://www.facebook.com/facebook/videos/10153231379946729/', // Random FB video placeholder
        status: 'LIVE'
    });

    await stream1.save();
    await stream2.save();

    console.log('Streams created!');
    process.exit(0);
})
.catch(err => {
    console.error(err);
    process.exit(1);
});
