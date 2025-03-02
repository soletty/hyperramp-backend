import { ethers } from 'ethers';
import config from '../config/config';
import { depositUsdcToHyperliquid, getHyperliquidBalance } from './hyperliquidService';

// Interface for pending transaction
interface PendingTransaction {
  id: string;
  walletAddress: string;
  amount: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  createdAt: Date;
  updatedAt: Date;
  stripeSessionId: string;
  txHash?: string;
  error?: string;
}

// Transaction status for API responses
export interface TransactionStatus {
  sessionId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  walletAddress: string;
  amount: number;
  txHash?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

// In-memory store for pending transactions
// In a production environment, this would be a database
const pendingTransactions: Map<string, PendingTransaction> = new Map();

// Track total amount onramped (initialized at 39 USDC as requested)
let totalOnrampedAmount = 39;

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
export async function getWalletBalance(): Promise<{
  balance: number;
  formattedBalance: string;
  availableForOnramp: number;
  pendingAmount: number;
}> {
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
    const { usdBalance } = await getHyperliquidBalance();
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
  } catch (error) {
    console.error('Error getting wallet balance:', error);
    throw error;
  }
}

/**
 * Calculate the total amount of pending transactions
 */
function calculatePendingAmount(): number {
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
export function createPendingTransaction(
  stripeSessionId: string,
  walletAddress: string,
  amount: number
): PendingTransaction {
  const now = new Date();
  const transaction: PendingTransaction = {
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
export function getPendingTransactionBySessionId(sessionId: string): PendingTransaction | undefined {
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
export function getTransactionStatus(sessionId: string): TransactionStatus | null {
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
export function getAllTransactionStatuses(): TransactionStatus[] {
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
export function updatePendingTransaction(
  id: string,
  updates: Partial<PendingTransaction>
): PendingTransaction | undefined {
  const transaction = pendingTransactions.get(id);
  
  if (!transaction) {
    return undefined;
  }
  
  const updatedTransaction = {
    ...transaction,
    ...updates,
    updatedAt: new Date()
  };
  
  pendingTransactions.set(id, updatedTransaction);
  return updatedTransaction;
}

/**
 * Delete a pending transaction
 * Note: We now only use this for cleanup, not immediately after completion/failure
 */
export function deletePendingTransaction(id: string): boolean {
  return pendingTransactions.delete(id);
}

/**
 * Process a deposit
 * This checks available balance, creates a pending transaction,
 * and calls the hyperliquidService to perform the deposit
 */
export async function processDeposit(
  stripeSessionId: string,
  destinationAddress: string,
  amount: number
): Promise<{ success: boolean; txHash?: string; error?: string; pendingTxId?: string }> {
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
      } else if (existingTx.status === 'failed') {
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
        const txHash = await depositUsdcToHyperliquid(destinationAddress, amount);
        
        // Update the transaction as completed
        updatePendingTransaction(pendingTxId, {
          status: 'completed',
          txHash
        });
        
        // Increment the total onramped amount
        incrementTotalOnrampedAmount(amount);
        
        return {
          success: true,
          txHash,
          pendingTxId
        };
      } catch (error) {
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
    const { availableForOnramp } = await getWalletBalance();
    
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
      const txHash = await depositUsdcToHyperliquid(destinationAddress, amount);
      
      // Update the transaction as completed
      updatePendingTransaction(pendingTx.id, {
        status: 'completed',
        txHash
      });
      
      // Increment the total onramped amount
      incrementTotalOnrampedAmount(amount);
      
      return {
        success: true,
        txHash,
        pendingTxId: pendingTx.id
      };
    } catch (error) {
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
  } catch (error) {
    console.error('Error processing deposit:', error);
    
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Get all pending transactions
 */
export function getAllPendingTransactions(): PendingTransaction[] {
  return Array.from(pendingTransactions.values());
}

/**
 * Clean up old completed/failed transactions
 * This would typically be done by a scheduled job
 * We keep completed/failed transactions for 24 hours by default
 */
export function cleanupOldTransactions(maxAgeHours = 24): void {
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

/**
 * Increment the total onramped amount
 * @param amount The amount to add to the total
 */
export function incrementTotalOnrampedAmount(amount: number): void {
  totalOnrampedAmount += amount;
  console.log(`💰 Total onramped amount increased by ${amount} USDC to ${totalOnrampedAmount} USDC`);
}

/**
 * Get the total onramped amount
 * @returns The total amount onramped in USDC
 */
export function getTotalOnrampedAmount(): number {
  return totalOnrampedAmount;
} 