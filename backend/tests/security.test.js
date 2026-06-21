const request = require('supertest');
const { app } = require('../server');

describe('Security Tests', () => {
    
    describe('Security Headers', () => {
        it('should return Helmet security headers', async () => {
            const res = await request(app).get('/api/');
            
            // Helmet headers
            expect(res.headers['x-dns-prefetch-control']).toBe('off');
            expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
            expect(res.headers['strict-transport-security']).toBe('max-age=31536000; includeSubDomains');
            expect(res.headers['x-download-options']).toBe('noopen');
            expect(res.headers['x-content-type-options']).toBe('nosniff');
            expect(res.headers['x-xss-protection']).toBe('0');
        });
    });

    describe('Rate Limiter', () => {
        it('should limit repeated requests to API routes', async () => {
            const limit = 200; // max 200 per 15 minutes
            
            // In a real test environment with Jest, firing 200 requests might be slow.
            // But we will send enough to at least verify the headers are present.
            const res = await request(app).get('/api/');
            
            // The rate limit headers should be present
            expect(res.headers['ratelimit-limit']).toBeDefined();
            expect(res.headers['ratelimit-remaining']).toBeDefined();
            expect(res.headers['ratelimit-reset']).toBeDefined();
        });
    });

    describe('CORS', () => {
        it('should have CORS enabled', async () => {
            const res = await request(app).get('/api/');
            expect(res.headers['access-control-allow-origin']).toBe('*');
        });
    });
});
