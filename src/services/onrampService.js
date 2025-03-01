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
Object.defineProperty(exports, "__esModule", { value: true });
exports.getWalletBalance = getWalletBalance;
exports.createPendingTransaction = createPendingTransaction;
exports.getPendingTransactionBySessionId = getPendingTransactionBySessionId;
exports.getTransactionStatus = getTransactionStatus;
exports.getAllTransactionStatuses = getAllTransactionStatuses;
exports.updatePendingTransaction = updatePendingTransaction;
exports.deletePendingTransaction = deletePendingTransaction;
exports.processDeposit = processDeposit;
exports.getAllPendingTransactions = getAllPendingTransactions;
exports.cleanupOldTransactions = cleanupOldTransactions;
const hyperliquidService_1 = require("./hyperliquidService");
// In-memory store for pending transactions
// In a production environment, this would be a database
const pendingTransactions = new Map();
// Cache for the last fetched wallet balance
let lastBalanceCheck = {
    timestamp: 0,
    balance: 0,
    decimals: 6
};
/**
 * Get the current USDC balance of the wallet
 * Caches the result for 30 seconds to avoid excessive API calls
 */
function getWalletBalance() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const now = Date.now();
            const cacheExpiry = 30 * 1000; // 30 seconds
            // If we have a recent balance check, use the cached value
            if (now - lastBalanceCheck.timestamp < cacheExpiry && lastBalanceCheck.balance > 0) {
                const pendingAmount = calculatePendingAmount();
                const availableForOnramp = Math.max(0, lastBalanceCheck.balance - pendingAmount);
                return {
                    balance: lastBalanceCheck.balance,
                    formattedBalance: lastBalanceCheck.balance.toFixed(2),
                    availableForOnramp,
                    pendingAmount
                };
            }
            // Get balance from Hyperliquid
            const { usdBalance } = yield (0, hyperliquidService_1.getHyperliquidBalance)();
            const balanceNumber = usdBalance;
            // Update the cache
            lastBalanceCheck = {
                timestamp: now,
                balance: balanceNumber,
                decimals: 6
            };
            // Calculate pending amount
            const pendingAmount = calculatePendingAmount();
            const availableForOnramp = Math.max(0, balanceNumber - pendingAmount);
            return {
                balance: balanceNumber,
                formattedBalance: balanceNumber.toFixed(2),
                availableForOnramp,
                pendingAmount
            };
        }
        catch (error) {
            console.error('Error getting wallet balance:', error);
            throw error;
        }
    });
}
/**
 * Calculate the total amount of pending transactions
 */
function calculatePendingAmount() {
    let total = 0;
    for (const tx of pendingTransactions.values()) {
        // Only count transactions that are not completed or failed
        if (tx.status === 'pending' || tx.status === 'processing') {
            total += tx.amount;
        }
    }
    return total;
}
/**
 * Create a new pending transaction
 */
function createPendingTransaction(stripeSessionId, walletAddress, amount) {
    const now = new Date();
    const transaction = {
        id: `tx_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
        walletAddress,
        amount,
        status: 'pending',
        createdAt: now,
        updatedAt: now,
        stripeSessionId
    };
    pendingTransactions.set(transaction.id, transaction);
    return transaction;
}
/**
 * Get a pending transaction by Stripe session ID
 */
function getPendingTransactionBySessionId(sessionId) {
    for (const tx of pendingTransactions.values()) {
        if (tx.stripeSessionId === sessionId) {
            return tx;
        }
    }
    return undefined;
}
/**
 * Get transaction status by Stripe session ID
 * This is used by the frontend to check the status of a transaction
 */
function getTransactionStatus(sessionId) {
    const tx = getPendingTransactionBySessionId(sessionId);
    if (!tx) {
        return null;
    }
    return {
        sessionId: tx.stripeSessionId,
        status: tx.status,
        walletAddress: tx.walletAddress,
        amount: tx.amount,
        txHash: tx.txHash,
        error: tx.error,
        createdAt: tx.createdAt.toISOString(),
        updatedAt: tx.updatedAt.toISOString()
    };
}
/**
 * Get all transaction statuses
 * This is used by the frontend to display a list of recent transactions
 */
function getAllTransactionStatuses() {
    return Array.from(pendingTransactions.values()).map(tx => ({
        sessionId: tx.stripeSessionId,
        status: tx.status,
        walletAddress: tx.walletAddress,
        amount: tx.amount,
        txHash: tx.txHash,
        error: tx.error,
        createdAt: tx.createdAt.toISOString(),
        updatedAt: tx.updatedAt.toISOString()
    }));
}
/**
 * Update a pending transaction
 */
function updatePendingTransaction(id, updates) {
    const transaction = pendingTransactions.get(id);
    if (!transaction) {
        return undefined;
    }
    const updatedTransaction = Object.assign(Object.assign(Object.assign({}, transaction), updates), { updatedAt: new Date() });
    pendingTransactions.set(id, updatedTransaction);
    return updatedTransaction;
}
/**
 * Delete a pending transaction
 * Note: We now only use this for cleanup, not immediately after completion/failure
 */
function deletePendingTransaction(id) {
    return pendingTransactions.delete(id);
}
/**
 * Process a deposit
 * This checks available balance, creates a pending transaction,
 * and calls the hyperliquidService to perform the deposit
 */
function processDeposit(stripeSessionId, destinationAddress, amount) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            console.log(`🔍 Processing deposit for session ${stripeSessionId}, wallet ${destinationAddress}, amount ${amount}`);
            // Check if we already have a transaction for this session
            const existingTx = getPendingTransactionBySessionId(stripeSessionId);
            console.log(`🔍 Existing transaction found: ${existingTx ? 'YES' : 'NO'}`);
            if (existingTx) {
                // If the transaction is already completed or failed, return its status
                if (existingTx.status === 'completed') {
                    return {
                        success: true,
                        txHash: existingTx.txHash,
                        pendingTxId: existingTx.id
                    };
                }
                else if (existingTx.status === 'failed') {
                    return {
                        success: false,
                        error: existingTx.error || 'Transaction failed',
                        pendingTxId: existingTx.id
                    };
                }
                // If it's still pending or processing, update it to processing and continue
                updatePendingTransaction(existingTx.id, { status: 'processing' });
                // Use the existing transaction ID
                const pendingTxId = existingTx.id;
                try {
                    // Process the deposit
                    const txHash = yield (0, hyperliquidService_1.depositUsdcToHyperliquid)(destinationAddress, amount);
                    // Update the transaction as completed
                    updatePendingTransaction(pendingTxId, {
                        status: 'completed',
                        txHash
                    });
                    return {
                        success: true,
                        txHash,
                        pendingTxId
                    };
                }
                catch (error) {
                    console.log('🚨 Caught error in processDeposit:', error);
                    // Update the transaction as failed
                    updatePendingTransaction(pendingTxId, {
                        status: 'failed',
                        error: error instanceof Error ? error.message : 'Unknown error'
                    });
                    console.log('📝 Updated transaction status to failed');
                    return {
                        success: false,
                        error: error instanceof Error ? error.message : 'Unknown error',
                        pendingTxId
                    };
                }
            }
            // Get current balance and available amount
            const { availableForOnramp } = yield getWalletBalance();
            // Check if we have enough balance
            if (availableForOnramp < amount) {
                // Create a failed transaction record
                const pendingTx = createPendingTransaction(stripeSessionId, destinationAddress, amount);
                updatePendingTransaction(pendingTx.id, {
                    status: 'failed',
                    error: `Insufficient balance for onramp. Required: ${amount} USDC, Available: ${availableForOnramp} USDC`
                });
                return {
                    success: false,
                    error: `Insufficient balance for onramp. Required: ${amount} USDC, Available: ${availableForOnramp} USDC`,
                    pendingTxId: pendingTx.id
                };
            }
            // Create a pending transaction
            const pendingTx = createPendingTransaction(stripeSessionId, destinationAddress, amount);
            // Update status to processing
            updatePendingTransaction(pendingTx.id, { status: 'processing' });
            try {
                // Process the deposit
                const txHash = yield (0, hyperliquidService_1.depositUsdcToHyperliquid)(destinationAddress, amount);
                // Update the transaction as completed
                updatePendingTransaction(pendingTx.id, {
                    status: 'completed',
                    txHash
                });
                return {
                    success: true,
                    txHash,
                    pendingTxId: pendingTx.id
                };
            }
            catch (error) {
                // Update the transaction as failed
                updatePendingTransaction(pendingTx.id, {
                    status: 'failed',
                    error: error instanceof Error ? error.message : 'Unknown error'
                });
                return {
                    success: false,
                    error: error instanceof Error ? error.message : 'Unknown error',
                    pendingTxId: pendingTx.id
                };
            }
        }
        catch (error) {
            console.error('Error processing deposit:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    });
}
/**
 * Get all pending transactions
 */
function getAllPendingTransactions() {
    return Array.from(pendingTransactions.values());
}
/**
 * Clean up old completed/failed transactions
 * This would typically be done by a scheduled job
 * We keep completed/failed transactions for 24 hours by default
 */
function cleanupOldTransactions(maxAgeHours = 24) {
    const now = Date.now();
    const maxAgeMs = maxAgeHours * 60 * 60 * 1000;
    for (const [id, tx] of pendingTransactions.entries()) {
        const txAge = now - tx.createdAt.getTime();
        // Remove old completed or failed transactions
        if ((tx.status === 'completed' || tx.status === 'failed') && txAge > maxAgeMs) {
            pendingTransactions.delete(id);
        }
    }
}
