const mongoose = require('mongoose');

const ClipSchema = new mongoose.Schema({
    title: {
        type: String,
        required: true
    },
    author: {
        type: String,
        required: true
    },
    game: {
        type: String,
        required: true
    },
    views: {
        type: String,
        required: true
    },
    thumbnail: {
        type: String,
        required: true
    },
    url: {
        type: String,
        default: '../public/DesktopBG.mp4'
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('Clip', ClipSchema);
