const request = require('supertest');
const { app } = require('../server');
const process = require('process');
const speakeasy = require('speakeasy');
require('dotenv').config();

describe('Admin Security & Session Auth Tests', () => {
    let adminRoute;

    beforeAll(() => {
        adminRoute = process.env.ADMIN_ROUTE_PREFIX || '/hidden-admin';
        // Need to set env variables for testing to ensure they are present
        process.env.ADMIN_PASSWORD = 'testpassword';
        process.env.ADMIN_MFA_SECRET = 'JBSWY3DPEHPK3PXP'; // Valid base32 secret
        process.env.SESSION_SECRET = 'testsecret';
    });

    it('should redirect unauthenticated users to the login page', async () => {
        const res = await request(app).get(adminRoute);
        expect(res.statusCode).toBe(302);
        expect(res.header.location).toBe(`${adminRoute}/login`);
    });

    it('should reject login with wrong password', async () => {
        const res = await request(app)
            .post(`${adminRoute}/login`)
            .send({ password: 'wrongpassword', mfaCode: '000000' });
            
        expect(res.text).toContain('Invalid password');
    });

    it('should reject login with wrong MFA code', async () => {
        const res = await request(app)
            .post(`${adminRoute}/login`)
            .send({ password: 'testpassword', mfaCode: '000000' });
            
        expect(res.text).toContain('Invalid 2FA code');
    });

    it('should allow login with valid credentials', async () => {
        const validMfaCode = speakeasy.totp({
            secret: process.env.ADMIN_MFA_SECRET,
            encoding: 'base32'
        });
        
        const res = await request(app)
            .post(`${adminRoute}/login`)
            .send({ password: 'testpassword', mfaCode: validMfaCode });
            
        // Should set a cookie and redirect to the dashboard
        expect(res.statusCode).toBe(302);
        expect(res.header.location).toBe(adminRoute);
        expect(res.header['set-cookie']).toBeDefined();
    });
});
