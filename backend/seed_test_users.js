const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const User = require('./models/User');

async function seed() {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("Connected to MongoDB.");

    // Delete existing users for test clarity
    await User.deleteMany({ email: { $in: ['test1@blaze.com', 'test2@blaze.com'] } });

    const user1 = new User({
        username: 'TestUserOne',
        email: 'test1@blaze.com',
        password: 'password123',
        playerId: 'Blz-11111',
        isVerified: true,
        blazeCoins: 1000
    });
    await user1.save();

    const user2 = new User({
        username: 'TestUserTwo',
        email: 'test2@blaze.com',
        password: 'password123',
        playerId: 'Blz-22222',
        isVerified: true,
        blazeCoins: 1000
    });
    await user2.save();

    const token1 = jwt.sign({ id: user1._id }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const token2 = jwt.sign({ id: user2._id }, process.env.JWT_SECRET, { expiresIn: '1h' });

    console.log(`User1 Token: ${token1}`);
    console.log(`User2 Token: ${token2}`);
    console.log(`Test User 1 Login: test1@blaze.com / password123`);
    console.log(`Test User 2 Login: test2@blaze.com / password123`);

    await mongoose.disconnect();
}
seed().catch(console.error);
