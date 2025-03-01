import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env file
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// Default values for environment variables
const config = {
  port: process.env.PORT || 3000,
  stripeSecretKey: process.env.VITE_STRIPE_SECRET_KEY || '',
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
  // The fee we charge on top of the ramp amount (0.5%)
  serviceFeePercent: 0.5,
  
  // Arbitrum and Hyperliquid configuration
  arbitrumRpcUrl: process.env.ARBITRUM_RPC_URL || 'https://arb1.arbitrum.io/rpc',
  usdcContractAddress: process.env.USDC_CONTRACT_ADDRESS || '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', // Arbitrum USDC
  hyperliquidBridgeAddress: process.env.HYPERLIQUID_BRIDGE_ADDRESS || '0x2df1c51e09aecf9cacb7bc98cb1742757f163df7', // Mainnet bridge
  walletPrivateKey: process.env.WALLET_PRIVATE_KEY || '',
  isMainnet: process.env.NETWORK_ENV === 'mainnet',
};

// Validate required environment variables
if (!config.stripeSecretKey) {
  throw new Error('VITE_STRIPE_SECRET_KEY is required');
}

export default config; 