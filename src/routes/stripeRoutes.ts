import express, { Router } from 'express';
import { createCheckoutSession, verifySession, handleWebhook } from '../controllers/stripeController';

const router = Router();

// Create checkout session route
router.post('/create-checkout', createCheckoutSession as express.RequestHandler);

// Verify session route
router.get('/verify-session', verifySession as express.RequestHandler);

// Stripe webhook route - needs raw body for signature verification
router.post('/webhook', 
  express.raw({ type: 'application/json' }),
  handleWebhook as express.RequestHandler
);

export default router; 