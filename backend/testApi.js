require('dotenv').config();
const mongoose = require('mongoose');

async function test() {
    await mongoose.connect(process.env.MONGO_URI);
    const User = require('./models/User');
    
    try {
        const user = await User.findOne({ playerId: 'BLZ-79IZJJ' });
        console.log("Found user:", user.playerId);
        
        const Match = require('./models/Match');
        const userMatches = await Match.find({ playerId: user._id, status: 'COMPLETED' });
        const userTotalBP = userMatches.reduce((acc, m) => acc + m.blazePoints, 0);
        
        const higherRankCount = await User.countDocuments({ blazeCoins: { $gt: user.blazeCoins || 0 } });
        const totalPlayers = await User.countDocuments();
        
        let percentile = 0;
        if (totalPlayers > 1) {
            percentile = Math.round((higherRankCount / totalPlayers) * 100);
        }
        console.log("Success! userTotalBP:", userTotalBP, "Percentile:", percentile);
    } catch(err) {
        console.error("ERROR CAUGHT:");
        console.error(err);
    }
    process.exit();
}
test();
