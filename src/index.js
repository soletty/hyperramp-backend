"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const config_1 = __importDefault(require("./config/config"));
const stripeRoutes_1 = __importDefault(require("./routes/stripeRoutes"));
const onrampRoutes_1 = __importDefault(require("./routes/onrampRoutes"));
const cors_1 = require("./middleware/cors");
// Initialize Express
const app = (0, express_1.default)();
// Apply custom CORS middleware before any other middleware
app.use(cors_1.corsMiddleware);
// Special handling for Stripe webhooks - needs raw body
app.use('/api/webhook', express_1.default.raw({ type: 'application/json' }));
// For all other routes, parse JSON
app.use(express_1.default.json());
// Routes
app.use('/api', stripeRoutes_1.default);
app.use('/api/onramp', onrampRoutes_1.default);
// Health check route
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
});
// Fallback route for /cancel to handle old links
app.get('/cancel', (req, res) => {
    res.redirect('/?canceled=true');
});
// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Error:', err);
    res.status(500).json({
        message: err.message || 'Something went wrong!',
    });
});
// Start the server
app.listen(config_1.default.port, () => {
    console.log(`Server running on port ${config_1.default.port}`);
    console.log(`API available at http://localhost:${config_1.default.port}/api`);
});
