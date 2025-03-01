import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env file
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// Default values for environment variables
const config = {
  port: process.env.PORT || 3000,
  stripeSecretKey: process.env.VITE_STRIPE_SECRET_KEY || '',
  // The fee we charge on top of the ramp amount (0.5%)
  serviceFeePercent: 0.5,
};

// Validate required environment variables
if (!config.stripeSecretKey) {
  throw new Error('VITE_STRIPE_SECRET_KEY is required');
}

export default config; 