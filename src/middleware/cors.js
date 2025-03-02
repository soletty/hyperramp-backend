"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.corsMiddleware = corsMiddleware;
function corsMiddleware(req, res, next) {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', 'https://hyperramp.xyz');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With, Content-Type, Accept, Authorization, stripe-signature');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    // Handle preflight requests
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    next();
}
