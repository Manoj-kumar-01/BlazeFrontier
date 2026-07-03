const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

async function run() {
    try {
        const secret = 'blaze_frontier_super_secret_key_2026';
        
        // Use a dummy user ID for testing. Assuming the backend accepts any valid ObjectId format for testing JWT.
        // Actually it's better to fetch a real user if authMiddleware checks DB, but usually JWT auth just verifies signature.
        const userId = '64abcd123456789012345678';
        const payload = {
            user: { id: userId, role: 'player' }
        };
        const token = jwt.sign(payload, secret, { expiresIn: '1h' });

        // Create a dummy mp4 file
        const dummyPath = path.join(__dirname, 'dummy.mp4');
        fs.writeFileSync(dummyPath, 'fake video data');

        const formData = new FormData();
        formData.append('title', 'Test Clip');
        formData.append('game', 'Free Fire');
        formData.append('playerId', 'Player123');
        formData.append('startTime', '0');
        formData.append('endTime', '10');
        
        const blob = new Blob([fs.readFileSync(dummyPath)], { type: 'video/mp4' });
        formData.append('clip', blob, 'dummy.mp4');

        console.log('Sending request...');
        const res = await fetch('http://localhost:5000/api/clips/submit', {
            method: 'POST',
            headers: {
                'x-auth-token': token
            },
            body: formData
        });

        const text = await res.text();
        console.log(`Status: ${res.status}`);
        console.log(`Response: ${text}`);

        fs.unlinkSync(dummyPath);
    } catch (err) {
        console.error('Error:', err);
    }
}

run();
