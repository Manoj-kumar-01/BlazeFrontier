const fetch = require('node-fetch') || global.fetch;

async function testApi() {
    try {
        const res = await fetch('http://localhost:5000/api/player/BLZ-79IZJJ', {
            // Need a valid token. Let's just create one manually using the secret, or bypass auth for local test.
        });
        console.log(await res.text());
    } catch(err) {
        console.error(err);
    }
}
testApi();
