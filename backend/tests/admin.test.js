const request = require('supertest');
const { app } = require('../server');
const process = require('process');
require('dotenv').config();

describe('Admin Routes & IP Whitelisting Tests', () => {
    let originalAdminIps;
    let adminRoute;

    beforeAll(() => {
        originalAdminIps = process.env.ADMIN_IPS;
        process.env.ADMIN_IPS = '127.0.0.1,::1,192.168.1.100,::ffff:127.0.0.1,::ffff:192.168.1.100'; // Set dummy IPs for test including mapped ones
        adminRoute = process.env.ADMIN_ROUTE_PREFIX || '/hidden-admin';
    });

    afterAll(() => {
        process.env.ADMIN_IPS = originalAdminIps;
    });

    it('should block non-whitelisted IP with a 404', async () => {
        const res = await request(app)
            .get(adminRoute)
            .set('x-forwarded-for', '10.0.0.5'); // Mocking an unauthorized IP
            
        // The middleware returns a fake 404 page
        expect(res.statusCode).toBe(404);
        expect(res.text).toContain('Cannot GET');
    });

    it('should allow whitelisted IP', async () => {
        const res = await request(app)
            .get(adminRoute)
            .set('x-forwarded-for', '192.168.1.100'); // Mocking an authorized IP
            
        // Assuming the admin page renders successfully (status 200 or 500 if DB not connected)
        // We mainly want to ensure it doesn't return 404 from our ipWhitelist middleware
        expect(res.statusCode).not.toBe(404);
    });

    it('should allow loopback (localhost) if in ADMIN_IPS', async () => {
        const res = await request(app)
            .get(adminRoute)
            .set('x-forwarded-for', '127.0.0.1'); 
            
        expect(res.statusCode).not.toBe(404);
    });
});
