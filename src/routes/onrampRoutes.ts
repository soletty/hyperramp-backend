import express, { Router, Request, Response } from 'express';
import { getWalletBalance } from '../services/onrampService';

const router = Router();

// Maximum amount allowed for onramp (in USD cents)
const MAX_AMOUNT_USD_CENTS = 250000; // $2,500.00
const MIN_AMOUNT_USD_CENTS = 500;   // $5.00

// Get onramp capacity route with explicit CORS handling
router.options('/capacity', (req: Request, res: Response) => {
  res.setHeader('Access-Control-Allow-Origin', 'https://hyperramp.xyz');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With, Content-Type, Accept, Authorization, stripe-signature');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.status(200).end();
});

router.get('/capacity', async (req: Request, res: Response) => {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', 'https://hyperramp.xyz');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With, Content-Type, Accept, Authorization, stripe-signature');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  
  try {
    const balanceInfo = await getWalletBalance();
    
    return res.status(200).json({
      success: true,
      ...balanceInfo,
      maxAmount: Math.min(balanceInfo.availableForOnramp, MAX_AMOUNT_USD_CENTS / 100),
      minAmount: MIN_AMOUNT_USD_CENTS / 100
    });
  } catch (error) {
    console.error('Error getting onramp capacity:', error);
    return res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Failed to get onramp capacity',
    });
  }
});

export default router; 