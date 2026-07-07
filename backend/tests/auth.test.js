const request = require('supertest');
const { app } = require('../server');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

jest.mock('../models/User', () => ({
    findById: jest.fn().mockResolvedValue({ role: 'user', email: 'test@test.com' })
}));

jest.setTimeout(30000);

beforeAll(async () => {
    require('dotenv').config();
    mongoose.set('bufferCommands', false); // Prevent hanging queries when no DB
});

afterAll(async () => {
    // No connection to close
});

describe('Authentication Tests', () => {
    
    it('should deny access without a token', async () => {
        const res = await request(app).get('/api/user/notifications');
        expect(res.statusCode).toBe(401);
        expect(res.body.msg).toBe('No token, authorization denied');
    });

    it('should deny access with an invalid token', async () => {
        const res = await request(app)
            .get('/api/user/notifications')
            .set('x-auth-token', 'invalid_token_string');
            
        expect(res.statusCode).toBe(401);
        expect(res.body.msg).toBe('Token is not valid');
    });

    it('should deny access with an expired token', async () => {
        // Sign an expired token
        const expiredToken = jwt.sign(
            { id: '123' },
            process.env.JWT_SECRET || 'blaze_secret_key_2024',
            { expiresIn: '-1h' }
        );

        const res = await request(app)
            .get('/api/user/notifications')
            .set('x-auth-token', expiredToken);
            
        expect(res.statusCode).toBe(401);
        expect(res.body.msg).toBe('Token is not valid');
    });

    it('should allow access with a valid token (requires DB connection or mock)', async () => {
        // Create a valid token
        const validToken = jwt.sign(
            { id: '64e8b3b0a7b4f51e44f8101f' }, // mock object id
            process.env.JWT_SECRET || 'blaze_secret_key_2024',
            { expiresIn: '1h' }
        );

        const res = await request(app)
            .get('/api/user/notifications')
            .set('x-auth-token', validToken);
            
        // Might be 500 if DB is not connected, but it shouldn't be 401
        expect(res.statusCode).not.toBe(401);
    });

});
