import express, { Router } from 'express';
import { 
  createCheckoutSession, 
  verifySession, 
  handleWebhook, 
  getOnrampCapacity,
  getTransactionStatusById,
  getAllTransactions,
  getTotalOnramped
} from '../controllers/stripeController';

const router = Router();

// Create checkout session route
router.post('/create-checkout', createCheckoutSession as express.RequestHandler);

// Verify session route
router.get('/verify-session', verifySession as express.RequestHandler);

// Get onramp capacity route
router.get('/onramp-capacity', getOnrampCapacity as express.RequestHandler);

// Get transaction status by session ID
router.get('/transaction/:sessionId', getTransactionStatusById as express.RequestHandler);

// Get all transactions
router.get('/transactions', getAllTransactions as express.RequestHandler);

// Get total onramped amount
router.get('/total-onramped', getTotalOnramped as express.RequestHandler);

// Stripe webhook route - needs raw body for signature verification
router.post('/webhook', 
  express.raw({ type: 'application/json' }),
  handleWebhook as express.RequestHandler
);

export default router; 