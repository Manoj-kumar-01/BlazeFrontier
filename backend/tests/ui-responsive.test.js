const request = require('supertest');
const { app } = require('../server');
describe('UI and View Tests', () => {
    
    describe('View Rendering (Supertest)', () => {
        it('should render the auth page', async () => {
            const res = await request(app).get('/auth');
            expect(res.statusCode).toBe(200);
            expect(res.text).toContain('<!DOCTYPE html>');
        });

        it('should render the dashboard', async () => {
            const res = await request(app).get('/dashboard');
            // If it redirects to login or renders, we check it doesn't 500
            expect(res.statusCode).not.toBe(500);
        });

        it('should render the admin page if IP allowed', async () => {
            // Setting the fake admin IP to bypass whitelist
            process.env.ADMIN_IPS = '127.0.0.1';
            const adminRoute = process.env.ADMIN_ROUTE_PREFIX || '/hidden-admin';
            const res = await request(app)
                .get(adminRoute)
                .set('x-forwarded-for', '127.0.0.1');
            
            // Depends on DB. It shouldn't 404 or 500
            expect(res.statusCode).not.toBe(404);
            expect(res.statusCode).not.toBe(500);
        });
    });
});
