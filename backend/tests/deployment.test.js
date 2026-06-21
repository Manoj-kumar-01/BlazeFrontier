require('dotenv').config();
const process = require('process');

describe('Deployment Readiness Tests', () => {

    it('should have MONGO_URI set', () => {
        expect(process.env.MONGO_URI).toBeDefined();
        expect(process.env.MONGO_URI.length).toBeGreaterThan(0);
    });

    it('should have JWT_SECRET set', () => {
        expect(process.env.JWT_SECRET).toBeDefined();
        expect(process.env.JWT_SECRET.length).toBeGreaterThan(0);
    });

    it('should have ADMIN_IPS set for route protection', () => {
        expect(process.env.ADMIN_IPS).toBeDefined();
        expect(process.env.ADMIN_IPS.length).toBeGreaterThan(0);
    });

    it('should run in production mode ideally, or test mode', () => {
        // Just checking that NODE_ENV is being utilized properly
        expect(['development', 'production', 'test']).toContain(process.env.NODE_ENV || 'development');
    });

});
