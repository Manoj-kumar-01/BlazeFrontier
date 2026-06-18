const mongoose = require('mongoose');

const DailyContentSchema = new mongoose.Schema({
    youtubeLink: {
        type: String,
        default: 'https://www.youtube.com/embed/live_stream?channel=UCYOURCHANNELID'
    },
    facebookLink: {
        type: String,
        default: 'https://www.facebook.com/plugins/video.php?href=https%3A%2F%2Fwww.facebook.com%2Ffacebook%2Fvideos%2F10153231379946729%2F&show_text=false'
    },
    title: {
        type: String,
        default: 'Daily Showcase'
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('DailyContent', DailyContentSchema);
