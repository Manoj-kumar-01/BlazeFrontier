const jwt = require('jsonwebtoken');
require('dotenv').config({ path: 'c:/Users/manoj/OneDrive/Desktop/BlazeFrontier/backend/.env' });
const mongoose = require('mongoose');

async function test() {
    await mongoose.connect(process.env.MONGO_URI);
    const User = require('./models/User');

    // Create a dummy user
    const user = new User({
        playerId: 'TEST-123',
        username: 'test_org_first_time',
        email: 'test_org_first_time@example.com',
        role: 'organizer'
    });
    await user.save();
    
    console.log('Saved user:', user._id);
    
    // Sign token
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    console.log('Generated token:', token);
    
    // Simulate /api/organizer/me
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const foundUser = await User.findById(decoded.id).select('role');
    
    console.log('Found user role:', foundUser ? foundUser.role : 'Not found');
    
    await mongoose.disconnect();
}

test().catch(console.error);
