import { Request, Response } from 'express';
import Stripe from 'stripe';
import config from '../config/config';

// Initialize Stripe with the secret key
const stripe = new Stripe(config.stripeSecretKey);

// Maximum amount allowed for onramp (in USD cents)
const MAX_AMOUNT_USD_CENTS = 250000; // $2,500.00
const MIN_AMOUNT_USD_CENTS = 1000;   // $10.00

/**
 * Create a Stripe checkout session
 */
export const createCheckoutSession = async (req: Request, res: Response) => {
  try {
    const { amount } = req.body;
    
    if (!amount || typeof amount !== 'number') {
      return res.status(400).json({ message: 'Valid amount is required' });
    }
    
    // Convert to cents for precision
    const baseAmountCents = Math.round(amount * 100);
    
    // Verify amount is within limits
    if (baseAmountCents > MAX_AMOUNT_USD_CENTS) {
      return res.status(400).json({ message: `Amount cannot exceed $${MAX_AMOUNT_USD_CENTS / 100}` });
    }
    
    if (baseAmountCents < MIN_AMOUNT_USD_CENTS) {
      return res.status(400).json({ message: `Amount must be at least $${MIN_AMOUNT_USD_CENTS / 100}` });
    }
    
    // Calculate our service fee (0.5%) - ADDED ON TOP of the base amount
    const serviceFeePercent = config.serviceFeePercent;
    const serviceFeeCents = Math.round(baseAmountCents * (serviceFeePercent / 100));
    
    // Calculate subtotal (base amount + service fee)
    const subtotalCents = baseAmountCents + serviceFeeCents;
    
    // Calculate Stripe's processing fee (2.9% + $0.30) - based on the subtotal
    const stripeFeePercent = 2.9;
    const stripeFeeFixed = 30; // 30 cents
    const stripeFeeCents = Math.round(subtotalCents * (stripeFeePercent / 100)) + stripeFeeFixed;
    
    // Total amount to be charged to the user
    const totalAmountCents = subtotalCents + stripeFeeCents;
    
    // Create a Stripe checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      // Only collect minimal billing details
      billing_address_collection: 'required',
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'USDC Deposit',
              description: `${amount.toFixed(2)} USDC to your wallet`,
            },
            unit_amount: baseAmountCents,
          },
          quantity: 1,
        },
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'Service Fee',
              description: `${serviceFeePercent}% service fee`,
            },
            unit_amount: serviceFeeCents,
          },
          quantity: 1,
        },
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'Processing Fee',
              description: `Stripe processing fee (${stripeFeePercent}% + $0.30)`,
            },
            unit_amount: stripeFeeCents,
          },
          quantity: 1,
        }
      ],
      custom_text: {
        submit: {
          message: `You will receive exactly ${amount.toFixed(2)} USDC. Service and processing fees are added to your total.`
        }
      },
      // Remove phone number collection
      phone_number_collection: {
        enabled: false,
      },
      // Email is always collected by default for receipts
      mode: 'payment',
      success_url: `${req.headers.origin}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${req.headers.origin}/?canceled=true`,
      // Store a note explaining the fee structure
      metadata: {
        baseAmount: amount.toString(),
        serviceFeePercent: serviceFeePercent.toString(),
        serviceFeeCents: serviceFeeCents.toString(),
        stripeFeeCents: stripeFeeCents.toString(),
        totalAmountCents: totalAmountCents.toString(),
        note: 'User pays USDC amount + service fee + Stripe processing fee',
      },
    });
    
    return res.status(200).json({
      sessionId: session.id,
      url: session.url,
      breakdown: {
        baseAmount: amount,
        serviceFee: serviceFeeCents / 100,
        stripeFee: stripeFeeCents / 100,
        totalAmount: totalAmountCents / 100
      }
    });
  } catch (error) {
    console.error('Error creating checkout session:', error);
    return res.status(500).json({
      message: error instanceof Error ? error.message : 'Failed to create checkout session',
    });
  }
};

/**
 * Verify a Stripe session after payment completes
 */
export const verifySession = async (req: Request, res: Response) => {
  try {
    const { id } = req.query;
    
    if (!id || typeof id !== 'string') {
      return res.status(400).json({ message: 'Valid session ID is required' });
    }
    
    // Retrieve the session from Stripe
    const session = await stripe.checkout.sessions.retrieve(id, {
      expand: ['line_items', 'payment_intent']
    });
    
    if (!session) {
      return res.status(404).json({ message: 'Session not found' });
    }
    
    // Check if payment was successful
    if (session.payment_status !== 'paid') {
      return res.status(400).json({
        success: false,
        message: `Payment status is ${session.payment_status}`,
      });
    }
    
    // Get the base amount from metadata
    const baseAmount = parseFloat(session.metadata?.baseAmount || '0');
    const serviceFee = parseFloat(session.metadata?.serviceFeeCents || '0') / 100;
    const stripeFee = parseFloat(session.metadata?.stripeFeeCents || '0') / 100;
    const totalPaid = parseFloat(session.metadata?.totalAmountCents || '0') / 100;
    
    // Return session details
    return res.status(200).json({
      success: true,
      session: {
        id: session.id,
        baseAmount: baseAmount,
        serviceFee: serviceFee,
        stripeFee: stripeFee,
        totalPaid: totalPaid,
        paymentStatus: session.payment_status,
        customer: session.customer,
        customerDetails: session.customer_details,
      },
    });
  } catch (error) {
    console.error('Error verifying session:', error);
    return res.status(500).json({
      message: error instanceof Error ? error.message : 'Failed to verify session',
    });
  }
}; 