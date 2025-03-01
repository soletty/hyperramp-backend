import { Request, Response } from 'express';
import Stripe from 'stripe';
import config from '../config/config';
import { 
  getWalletBalance, 
  processDeposit, 
  getTransactionStatus,
  getAllTransactionStatuses
} from '../services/onrampService';

// Initialize Stripe with the secret key
const stripe = new Stripe(config.stripeSecretKey);

// Maximum amount allowed for onramp (in USD cents)
const MAX_AMOUNT_USD_CENTS = 250000; // $2,500.00
const MIN_AMOUNT_USD_CENTS = 500;   // $5.00

/**
 * Create a Stripe checkout session
 */
export const createCheckoutSession = async (req: Request, res: Response) => {
  try {
    const { amount, walletAddress } = req.body;
    
    if (!amount || typeof amount !== 'number') {
      return res.status(400).json({ message: 'Valid amount is required' });
    }
    
    if (!walletAddress || typeof walletAddress !== 'string') {
      return res.status(400).json({ message: 'Valid wallet address is required' });
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
    
    // Check if we have enough balance for this onramp
    try {
      const { availableForOnramp } = await getWalletBalance();
      
      if (availableForOnramp < amount) {
        return res.status(400).json({
          message: `Insufficient balance for onramp. Maximum available: $${availableForOnramp.toFixed(2)}`,
          availableForOnramp
        });
      }
    } catch (error) {
      console.error('Error checking wallet balance:', error);
      // Continue with the checkout creation even if balance check fails
      // We'll check again when processing the payment
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
        walletAddress: walletAddress,
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
    const walletAddress = session.metadata?.walletAddress || '';
    
    // Check if we have a transaction status for this session
    const txStatus = getTransactionStatus(id);
    
    // Return session details
    return res.status(200).json({
      success: true,
      session: {
        id: session.id,
        baseAmount: baseAmount,
        serviceFee: serviceFee,
        stripeFee: stripeFee,
        totalPaid: totalPaid,
        walletAddress: walletAddress,
        paymentStatus: session.payment_status,
        customer: session.customer,
        customerDetails: session.customer_details,
      },
      transaction: txStatus || {
        status: 'pending',
        sessionId: id,
        walletAddress,
        amount: baseAmount,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Error verifying session:', error);
    return res.status(500).json({
      message: error instanceof Error ? error.message : 'Failed to verify session',
    });
  }
};

/**
 * Handle Stripe webhook events
 */
export const handleWebhook = async (req: Request, res: Response) => {
  console.log('🔔 Webhook received!');
  
  const sig = req.headers['stripe-signature'] as string;
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET || config.stripeWebhookSecret;
  
  if (!endpointSecret) {
    console.error('❌ Webhook secret not configured');
    return res.status(500).json({ message: 'Webhook secret not configured' });
  }
  
  let event: Stripe.Event;
  
  try {
    // Verify the event came from Stripe
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      endpointSecret
    );
    console.log(`✅ Webhook verified! Event type: ${event.type}`);
  } catch (err) {
    console.error('❌ Webhook signature verification failed:', err);
    return res.status(400).json({ message: 'Webhook signature verification failed' });
  }
  
  // Handle the event
  switch (event.type) {
    case 'checkout.session.completed':
      const session = event.data.object as Stripe.Checkout.Session;
      console.log(`💰 Checkout session completed: ${session.id}`);
      console.log(`Payment status: ${session.payment_status}`);
      
      // Make sure the payment was successful
      if (session.payment_status === 'paid') {
        console.log('✅ Payment was successful!');
        
        // Get the wallet address and amount from the session metadata
        const walletAddress = session.metadata?.walletAddress;
        const baseAmount = parseFloat(session.metadata?.baseAmount || '0');
        
        console.log('📝 Session metadata:', session.metadata);
        
        if (walletAddress && baseAmount) {
          console.log(`🔑 Wallet Address: ${walletAddress}`);
          console.log(`💵 Amount: ${baseAmount} USDC`);
          
          try {
            // Process the USDC deposit to Hyperliquid using our onramp service
            console.log('🔄 About to process deposit...');
            const result = await processDeposit(session.id, walletAddress, baseAmount);
            console.log('📊 Process deposit result:', JSON.stringify(result, null, 2));
            
            if (result.success) {
              console.log(`🚀 Successfully processed USDC deposit of ${baseAmount} to ${walletAddress}`);
              console.log(`🧾 Transaction hash: ${result.txHash}`);
              
              // We no longer delete the transaction immediately
              // It will be cleaned up by the scheduled job after 24 hours
            } else {
              console.error(`❌ Failed to process deposit: ${result.error}`);
              console.log('💸 Attempting to issue refund...');
              
              // Issue a refund to the customer
              try {
                if (session.payment_intent) {
                  const paymentIntentId = typeof session.payment_intent === 'string' 
                    ? session.payment_intent 
                    : session.payment_intent.id;
                  
                  console.log(`💸 Issuing refund for payment intent: ${paymentIntentId}`);
                  
                  const refund = await stripe.refunds.create({
                    payment_intent: paymentIntentId,
                    reason: 'requested_by_customer',
                  });
                  
                  console.log(`✅ Refund issued: ${refund.id}`);
                  
                  // We no longer delete the transaction immediately
                  // It will be cleaned up by the scheduled job after 24 hours
                } else {
                  console.error('❌ Cannot issue refund: No payment intent found in session');
                }
              } catch (refundError) {
                console.error('❌ Error issuing refund:', refundError);
              }
            }
          } catch (error) {
            console.error('❌ Error processing USDC deposit:', error);
            // Note: We're still returning a 200 to Stripe to acknowledge receipt
            // You should implement proper error handling and retry logic
          }
        } else {
          console.error('❌ Missing wallet address or amount in session metadata');
          console.error('Metadata received:', session.metadata);
        }
      } else {
        console.log(`⚠️ Payment status is not 'paid': ${session.payment_status}`);
      }
      break;
      
    default:
      console.log(`ℹ️ Unhandled event type: ${event.type}`);
  }
  
  // Return a 200 response to acknowledge receipt of the event
  console.log('✅ Webhook processed successfully');
  res.status(200).json({ received: true });
};

/**
 * Get the current wallet balance and available amount for onramp
 */
export const getOnrampCapacity = async (req: Request, res: Response) => {
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
};

/**
 * Get transaction status by session ID
 */
export const getTransactionStatusById = async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    
    if (!sessionId) {
      return res.status(400).json({ 
        success: false,
        message: 'Session ID is required' 
      });
    }
    
    const txStatus = getTransactionStatus(sessionId);
    
    if (!txStatus) {
      return res.status(404).json({ 
        success: false,
        message: 'Transaction not found' 
      });
    }
    
    return res.status(200).json({
      success: true,
      transaction: txStatus
    });
  } catch (error) {
    console.error('Error getting transaction status:', error);
    return res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Failed to get transaction status',
    });
  }
};

/**
 * Get all transaction statuses
 */
export const getAllTransactions = async (req: Request, res: Response) => {
  try {
    const transactions = getAllTransactionStatuses();
    
    return res.status(200).json({
      success: true,
      transactions
    });
  } catch (error) {
    console.error('Error getting all transactions:', error);
    return res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Failed to get all transactions',
    });
  }
}; 