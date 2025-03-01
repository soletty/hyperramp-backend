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
            // Process the USDC deposit to Hyperliquid
            await processUsdcDeposit(walletAddress, baseAmount);
            console.log(`🚀 Successfully processed USDC deposit of ${baseAmount} to ${walletAddress}`);
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
 * Process a USDC deposit to Hyperliquid
 * This is where you would implement the actual deposit logic
 */
async function processUsdcDeposit(destinationAddress: string, amount: number): Promise<void> {
  // TODO: Implement the actual deposit logic using ethers.js or similar
  // This is a placeholder function that would be replaced with actual implementation
  
  console.log(`\n========== PROCESSING DEPOSIT ==========`);
  console.log(`📤 Processing deposit of ${amount} USDC to ${destinationAddress}`);
  
  // 1. Connect to Arbitrum network
  // 2. Load your wallet using private key from env
  // 3. Send USDC to the bridge contract
  
  // Example implementation would look something like this:
  /*
  const provider = new ethers.providers.JsonRpcProvider(process.env.ARBITRUM_RPC_URL);
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  
  // USDC contract on Arbitrum
  const usdcContract = new ethers.Contract(
    process.env.USDC_CONTRACT_ADDRESS,
    ['function transfer(address to, uint256 amount) returns (bool)'],
    wallet
  );
  
  // Bridge contract address
  const bridgeAddress = '0x2df1c51e09aecf9cacb7bc98cb1742757f163df7'; // Mainnet
  
  // Convert amount to proper decimal representation (USDC has 6 decimals)
  const amountInWei = ethers.utils.parseUnits(amount.toString(), 6);
  
  // Send USDC to the bridge with the user's address in the data field
  const tx = await usdcContract.transfer(bridgeAddress, amountInWei);
  await tx.wait();
  */
  
  // For now, we'll just log that we would process the deposit
  console.log('💼 Deposit would be processed here');
  console.log(`✅ Deposit of ${amount} USDC to ${destinationAddress} would be complete`);
  console.log(`========================================\n`);
} 