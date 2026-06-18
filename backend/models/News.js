const mongoose = require('mongoose');

const NewsSchema = new mongoose.Schema({
    tag: {
        type: String,
        required: true
    },
    tagClass: {
        type: String,
        required: true
    },
    title: {
        type: String,
        required: true
    },
    date: {
        type: String,
        required: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('News', NewsSchema);
