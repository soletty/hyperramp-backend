import express, { Router } from 'express';
import { createCheckoutSession, verifySession } from '../controllers/stripeController';

const router = Router();

// Create checkout session route
router.post('/create-checkout', createCheckoutSession as express.RequestHandler);

// Verify session route
router.get('/verify-session', verifySession as express.RequestHandler);

export default router; 