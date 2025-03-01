"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
// Load environment variables from .env file
dotenv_1.default.config({ path: path_1.default.resolve(__dirname, '../../.env') });
// Default values for environment variables
const config = {
    port: process.env.PORT || 3000,
    stripeSecretKey: process.env.VITE_STRIPE_SECRET_KEY || '',
    stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
    // The fee we charge on top of the ramp amount (0.5%)
    serviceFeePercent: 0.5,
    // Hyperliquid configuration
    hyperliquidApiUrl: process.env.HYPERLIQUID_API_URL || 'https://api.hyperliquid.xyz',
    hyperliquidChain: process.env.HYPERLIQUID_CHAIN || 'Mainnet', // 'Mainnet' or 'Testnet'
    walletPrivateKey: process.env.WALLET_PRIVATE_KEY || '',
    isMainnet: process.env.NETWORK_ENV === 'mainnet',
};
// Validate required environment variables
if (!config.stripeSecretKey) {
    throw new Error('VITE_STRIPE_SECRET_KEY is required');
}
exports.default = config;
