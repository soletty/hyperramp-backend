import { ethers } from 'ethers';
import config from '../config/config';

// ABI for USDC token (only the transfer function)
const USDC_ABI = [
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
];

/**
 * Deposit USDC to the Hyperliquid bridge
 * @param destinationAddress The user's Hyperliquid address
 * @param amount The amount of USDC to deposit
 */
export async function depositUsdcToHyperliquid(destinationAddress: string, amount: number): Promise<string> {
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
    
    // Connect to Arbitrum network
    const provider = new ethers.providers.JsonRpcProvider(config.arbitrumRpcUrl);
    const wallet = new ethers.Wallet(config.walletPrivateKey, provider);
    
    // Get the USDC contract
    const usdcContract = new ethers.Contract(
      config.usdcContractAddress,
      USDC_ABI,
      wallet
    );
    
    // Get USDC decimals
    const decimals = await usdcContract.decimals();
    
    // Check wallet balance
    const balance = await usdcContract.balanceOf(wallet.address);
    const balanceFormatted = ethers.utils.formatUnits(balance, decimals);
    
    console.log(`Wallet balance: ${balanceFormatted} USDC`);
    
    if (parseFloat(balanceFormatted) < amount) {
      throw new Error(`Insufficient balance. Required: ${amount} USDC, Available: ${balanceFormatted} USDC`);
    }
    
    // Convert amount to proper decimal representation
    const amountInWei = ethers.utils.parseUnits(amount.toString(), decimals);
    
    console.log(`Sending ${amount} USDC to Hyperliquid bridge for ${destinationAddress}`);
    
    // Send USDC to the bridge
    const tx = await usdcContract.transfer(config.hyperliquidBridgeAddress, amountInWei);
    console.log(`Transaction hash: ${tx.hash}`);
    
    // Wait for transaction confirmation
    const receipt = await tx.wait();
    console.log(`Transaction confirmed in block ${receipt.blockNumber}`);
    
    return tx.hash;
  } catch (error) {
    console.error('Error depositing USDC to Hyperliquid:', error);
    throw error;
  }
} 