const mongoose = require('mongoose');

const SeriesSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true
    },
    game: {
        type: String,
        required: true
    },
    status: {
        type: String,
        enum: ['REGISTERING', 'ONGOING', 'COMPLETED'],
        default: 'REGISTERING'
    },
    totalMatches: {
        type: Number,
        default: 5
    },
    prizePool: {
        type: String,
        default: "₹0"
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('Series', SeriesSchema);
