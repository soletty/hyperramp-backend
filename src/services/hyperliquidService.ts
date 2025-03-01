import { ethers } from 'ethers';
import config from '../config/config';
import axios from 'axios';

// Hyperliquid API base URL from config
const API_BASE_URL = config.hyperliquidApiUrl;

/**
 * Get the USDC balance of the wallet on Hyperliquid
 */
export async function getHyperliquidBalance(): Promise<{
  usdBalance: number;
  formattedBalance: string;
}> {
  try {
    if (!config.walletPrivateKey) {
      throw new Error('Wallet private key not configured');
    }
    
    const wallet = new ethers.Wallet(config.walletPrivateKey);
    const walletAddress = wallet.address;
    
    // Get user's account state from Hyperliquid API
    const response = await axios.post(`${API_BASE_URL}/info`, {
      type: 'clearinghouseState',
      user: walletAddress
    });
    
    // Check if response data exists and has the expected structure
    if (response.data && 
        typeof response.data === 'object' && 
        'withdrawable' in response.data) {
      // The withdrawable amount is the USDC balance available for transfers
      const usdBalance = parseFloat(response.data.withdrawable as string);
      return {
        usdBalance,
        formattedBalance: usdBalance.toFixed(2)
      };
    }
    
    throw new Error('Failed to get balance from Hyperliquid API');
  } catch (error) {
    console.error('Error getting Hyperliquid balance:', error);
    throw error;
  }
}

/**
 * Send USDC from our wallet to a user's address on Hyperliquid
 * @param destinationAddress The user's Hyperliquid address
 * @param amount The amount of USDC to send
 */
export async function depositUsdcToHyperliquid(destinationAddress: string, amount: number): Promise<string> {
  console.log('🌊 depositUsdcToHyperliquid called - THIS SHOULD NOT HAPPEN IF TEST ERROR IS WORKING');
  
  try {
    // Validate inputs
    if (!ethers.utils.isAddress(destinationAddress)) {
      throw new Error('Invalid destination address');
    }
    
    if (amount < 5) {
      throw new Error('Minimum deposit amount is 5 USDC');
    }
    
    if (!config.walletPrivateKey) {
      throw new Error('Wallet private key not configured');
    }
    
    // Create wallet from private key
    const wallet = new ethers.Wallet(config.walletPrivateKey);
    
    // Check our balance first
    const { usdBalance } = await getHyperliquidBalance();
    
    if (usdBalance < amount) {
      throw new Error(`Insufficient balance. Required: ${amount} USDC, Available: ${usdBalance} USDC`);
    }
    
    console.log(`Sending ${amount} USDC to ${destinationAddress} on Hyperliquid`);
    
    // Current timestamp in milliseconds
    const timestamp = Date.now();
    
    // Create the message to sign
    const domain = {
      name: 'HyperliquidSignTransaction',
      version: '1',
      chainId: 42161, // Arbitrum chainId
      verifyingContract: '0x0000000000000000000000000000000000000000'
    };
    
    const types = {
      'HyperliquidTransaction:UsdSend': [
        { name: 'hyperliquidChain', type: 'string' },
        { name: 'destination', type: 'string' },
        { name: 'amount', type: 'string' },
        { name: 'time', type: 'uint64' }
      ]
    };
    
    const message = {
      hyperliquidChain: config.hyperliquidChain,
      destination: destinationAddress,
      amount: amount.toString(),
      time: timestamp
    };
    
    // Sign the message using EIP-712
    const signature = await wallet._signTypedData(domain, types, message);
    
    // Extract r, s, v from signature
    const sig = ethers.utils.splitSignature(signature);
    
    // Make the API request to send USDC
    const response = await axios.post(`${API_BASE_URL}/exchange`, {
      action: {
        type: 'usdSend',
        hyperliquidChain: config.hyperliquidChain,
        signatureChainId: '0xa4b1', // Arbitrum in hex
        destination: destinationAddress,
        amount: amount.toString(),
        time: timestamp
      },
      nonce: timestamp,
      signature: {
        r: sig.r,
        s: sig.s,
        v: sig.v
      }
    });
    
    // Check if response was successful
    if (response.data && 
        typeof response.data === 'object' && 
        'status' in response.data && 
        response.data.status === 'ok') {
      console.log('✅ USDC transfer successful');
      // Generate a transaction hash-like identifier for tracking
      const txHash = ethers.utils.id(`${wallet.address}-${destinationAddress}-${amount}-${timestamp}`);
      return txHash;
    } else {
      throw new Error(`Failed to send USDC: ${JSON.stringify(response.data)}`);
    }
  } catch (error) {
    console.error('Error sending USDC on Hyperliquid:', error);
    throw error;
  }
} 