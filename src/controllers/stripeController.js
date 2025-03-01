"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAllTransactions = exports.getTransactionStatusById = exports.getOnrampCapacity = exports.handleWebhook = exports.verifySession = exports.createCheckoutSession = void 0;
const stripe_1 = __importDefault(require("stripe"));
const config_1 = __importDefault(require("../config/config"));
const onrampService_1 = require("../services/onrampService");
// Initialize Stripe with the secret key
const stripe = new stripe_1.default(config_1.default.stripeSecretKey);
// Maximum amount allowed for onramp (in USD cents)
const MAX_AMOUNT_USD_CENTS = 250000; // $2,500.00
const MIN_AMOUNT_USD_CENTS = 500; // $5.00
/**
 * Create a Stripe checkout session
 */
const createCheckoutSession = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { amount, walletAddress } = req.body;
        if (!amount || typeof amount !== 'number' || amount <= 0) {
            return res.status(400).json({ message: 'Valid amount is required (must be a positive number)' });
        }
        if (!walletAddress || typeof walletAddress !== 'string') {
            return res.status(400).json({ message: 'Valid wallet address is required' });
        }
        // Validate wallet address format (must be a valid Ethereum address)
        if (!walletAddress.match(/^0x[a-fA-F0-9]{40}$/)) {
            return res.status(400).json({ message: 'Invalid wallet address format' });
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
            const { availableForOnramp } = yield (0, onrampService_1.getWalletBalance)();
            if (availableForOnramp < amount) {
                return res.status(400).json({
                    message: `Insufficient balance for onramp. Maximum available: $${availableForOnramp.toFixed(2)}`,
                    availableForOnramp
                });
            }
        }
        catch (error) {
            console.error('Error checking wallet balance:', error);
            // Continue with the checkout creation even if balance check fails
            // We'll check again when processing the payment
        }
        // Calculate our service fee (0.5%) - ADDED ON TOP of the base amount
        const serviceFeePercent = config_1.default.serviceFeePercent;
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
        const session = yield stripe.checkout.sessions.create({
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
    }
    catch (error) {
        console.error('Error creating checkout session:', error);
        return res.status(500).json({
            message: error instanceof Error ? error.message : 'Failed to create checkout session',
        });
    }
});
exports.createCheckoutSession = createCheckoutSession;
/**
 * Verify a Stripe session after payment completes
 */
const verifySession = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e;
    try {
        const { id } = req.query;
        if (!id || typeof id !== 'string' || id.trim() === '') {
            return res.status(400).json({ message: 'Valid session ID is required' });
        }
        // Validate session ID format (basic check for potential injection)
        if (id.length > 100 || /[<>]/.test(id)) {
            return res.status(400).json({ message: 'Invalid session ID format' });
        }
        // Retrieve the session from Stripe
        const session = yield stripe.checkout.sessions.retrieve(id, {
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
        const baseAmount = parseFloat(((_a = session.metadata) === null || _a === void 0 ? void 0 : _a.baseAmount) || '0');
        const serviceFee = parseFloat(((_b = session.metadata) === null || _b === void 0 ? void 0 : _b.serviceFeeCents) || '0') / 100;
        const stripeFee = parseFloat(((_c = session.metadata) === null || _c === void 0 ? void 0 : _c.stripeFeeCents) || '0') / 100;
        const totalPaid = parseFloat(((_d = session.metadata) === null || _d === void 0 ? void 0 : _d.totalAmountCents) || '0') / 100;
        const walletAddress = ((_e = session.metadata) === null || _e === void 0 ? void 0 : _e.walletAddress) || '';
        // Check if we have a transaction status for this session
        const txStatus = (0, onrampService_1.getTransactionStatus)(id);
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
    }
    catch (error) {
        console.error('Error verifying session:', error);
        return res.status(500).json({
            message: error instanceof Error ? error.message : 'Failed to verify session',
        });
    }
});
exports.verifySession = verifySession;
/**
 * Handle Stripe webhook events
 */
const handleWebhook = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    console.log('🔔 Webhook received!');
    const sig = req.headers['stripe-signature'];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET || config_1.default.stripeWebhookSecret;
    if (!endpointSecret) {
        console.error('❌ Webhook secret not configured');
        return res.status(500).json({ message: 'Webhook secret not configured' });
    }
    let event;
    try {
        // Verify the event came from Stripe
        event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
        console.log(`✅ Webhook verified! Event type: ${event.type}`);
    }
    catch (err) {
        console.error('❌ Webhook signature verification failed:', err);
        return res.status(400).json({ message: 'Webhook signature verification failed' });
    }
    // Handle the event
    switch (event.type) {
        case 'checkout.session.completed':
            const session = event.data.object;
            console.log(`💰 Checkout session completed: ${session.id}`);
            console.log(`Payment status: ${session.payment_status}`);
            // Make sure the payment was successful
            if (session.payment_status === 'paid') {
                console.log('✅ Payment was successful!');
                // Get the wallet address and amount from the session metadata
                const walletAddress = (_a = session.metadata) === null || _a === void 0 ? void 0 : _a.walletAddress;
                const baseAmount = parseFloat(((_b = session.metadata) === null || _b === void 0 ? void 0 : _b.baseAmount) || '0');
                console.log('📝 Session metadata:', session.metadata);
                if (walletAddress && baseAmount) {
                    console.log(`🔑 Wallet Address: ${walletAddress}`);
                    console.log(`💵 Amount: ${baseAmount} USDC`);
                    try {
                        // Process the USDC deposit to Hyperliquid using our onramp service
                        console.log('🔄 About to process deposit...');
                        const result = yield (0, onrampService_1.processDeposit)(session.id, walletAddress, baseAmount);
                        console.log('📊 Process deposit result:', JSON.stringify(result, null, 2));
                        if (result.success) {
                            console.log(`🚀 Successfully processed USDC deposit of ${baseAmount} to ${walletAddress}`);
                            console.log(`🧾 Transaction hash: ${result.txHash}`);
                            // We no longer delete the transaction immediately
                            // It will be cleaned up by the scheduled job after 24 hours
                        }
                        else {
                            console.error(`❌ Failed to process deposit: ${result.error}`);
                            console.log('💸 Attempting to issue refund...');
                            // Issue a refund to the customer
                            try {
                                if (session.payment_intent) {
                                    const paymentIntentId = typeof session.payment_intent === 'string'
                                        ? session.payment_intent
                                        : session.payment_intent.id;
                                    console.log(`💸 Issuing refund for payment intent: ${paymentIntentId}`);
                                    const refund = yield stripe.refunds.create({
                                        payment_intent: paymentIntentId,
                                        reason: 'requested_by_customer',
                                    });
                                    console.log(`✅ Refund issued: ${refund.id}`);
                                    // We no longer delete the transaction immediately
                                    // It will be cleaned up by the scheduled job after 24 hours
                                }
                                else {
                                    console.error('❌ Cannot issue refund: No payment intent found in session');
                                }
                            }
                            catch (refundError) {
                                console.error('❌ Error issuing refund:', refundError);
                            }
                        }
                    }
                    catch (error) {
                        console.error('❌ Error processing USDC deposit:', error);
                        // Note: We're still returning a 200 to Stripe to acknowledge receipt
                        // You should implement proper error handling and retry logic
                    }
                }
                else {
                    console.error('❌ Missing wallet address or amount in session metadata');
                    console.error('Metadata received:', session.metadata);
                }
            }
            else {
                console.log(`⚠️ Payment status is not 'paid': ${session.payment_status}`);
            }
            break;
        default:
            console.log(`ℹ️ Unhandled event type: ${event.type}`);
    }
    // Return a 200 response to acknowledge receipt of the event
    console.log('✅ Webhook processed successfully');
    res.status(200).json({ received: true });
});
exports.handleWebhook = handleWebhook;
/**
 * Get the current wallet balance and available amount for onramp
 */
const getOnrampCapacity = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const balanceInfo = yield (0, onrampService_1.getWalletBalance)();
        return res.status(200).json(Object.assign(Object.assign({ success: true }, balanceInfo), { maxAmount: Math.min(balanceInfo.availableForOnramp, MAX_AMOUNT_USD_CENTS / 100), minAmount: MIN_AMOUNT_USD_CENTS / 100 }));
    }
    catch (error) {
        console.error('Error getting onramp capacity:', error);
        return res.status(500).json({
            success: false,
            message: error instanceof Error ? error.message : 'Failed to get onramp capacity',
        });
    }
});
exports.getOnrampCapacity = getOnrampCapacity;
/**
 * Get transaction status by session ID
 */
const getTransactionStatusById = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { sessionId } = req.params;
        if (!sessionId || typeof sessionId !== 'string' || sessionId.trim() === '') {
            return res.status(400).json({
                success: false,
                message: 'Valid session ID is required'
            });
        }
        // Validate session ID format (basic check for potential injection)
        if (sessionId.length > 100 || /[<>]/.test(sessionId)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid session ID format'
            });
        }
        const txStatus = (0, onrampService_1.getTransactionStatus)(sessionId);
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
    }
    catch (error) {
        console.error('Error getting transaction status:', error);
        return res.status(500).json({
            success: false,
            message: error instanceof Error ? error.message : 'Failed to get transaction status',
        });
    }
});
exports.getTransactionStatusById = getTransactionStatusById;
/**
 * Get all transaction statuses
 */
const getAllTransactions = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const transactions = (0, onrampService_1.getAllTransactionStatuses)();
        return res.status(200).json({
            success: true,
            transactions
        });
    }
    catch (error) {
        console.error('Error getting all transactions:', error);
        return res.status(500).json({
            success: false,
            message: error instanceof Error ? error.message : 'Failed to get all transactions',
        });
    }
});
exports.getAllTransactions = getAllTransactions;
