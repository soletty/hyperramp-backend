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
exports.getHyperliquidBalance = getHyperliquidBalance;
exports.depositUsdcToHyperliquid = depositUsdcToHyperliquid;
const ethers_1 = require("ethers");
const config_1 = __importDefault(require("../config/config"));
const axios_1 = __importDefault(require("axios"));
// Hyperliquid API base URL from config
const API_BASE_URL = config_1.default.hyperliquidApiUrl;
/**
 * Get the USDC balance of the wallet on Hyperliquid
 */
function getHyperliquidBalance() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            if (!config_1.default.walletPrivateKey) {
                throw new Error('Wallet private key not configured');
            }
            const wallet = new ethers_1.ethers.Wallet(config_1.default.walletPrivateKey);
            const walletAddress = wallet.address;
            // Get user's account state from Hyperliquid API
            const response = yield axios_1.default.post(`${API_BASE_URL}/info`, {
                type: 'clearinghouseState',
                user: walletAddress
            });
            // Check if response data exists and has the expected structure
            if (response.data &&
                typeof response.data === 'object' &&
                'withdrawable' in response.data) {
                // The withdrawable amount is the USDC balance available for transfers
                const usdBalance = parseFloat(response.data.withdrawable);
                return {
                    usdBalance,
                    formattedBalance: usdBalance.toFixed(2)
                };
            }
            throw new Error('Failed to get balance from Hyperliquid API');
        }
        catch (error) {
            console.error('Error getting Hyperliquid balance:', error);
            throw error;
        }
    });
}
/**
 * Send USDC from our wallet to a user's address on Hyperliquid
 * @param destinationAddress The user's Hyperliquid address
 * @param amount The amount of USDC to send
 */
function depositUsdcToHyperliquid(destinationAddress, amount) {
    return __awaiter(this, void 0, void 0, function* () {
        console.log('🌊 depositUsdcToHyperliquid called - THIS SHOULD NOT HAPPEN IF TEST ERROR IS WORKING');
        try {
            // Validate inputs
            if (!ethers_1.ethers.utils.isAddress(destinationAddress)) {
                throw new Error('Invalid destination address');
            }
            if (amount < 5) {
                throw new Error('Minimum deposit amount is 5 USDC');
            }
            if (!config_1.default.walletPrivateKey) {
                throw new Error('Wallet private key not configured');
            }
            // Create wallet from private key
            const wallet = new ethers_1.ethers.Wallet(config_1.default.walletPrivateKey);
            // Check our balance first
            const { usdBalance } = yield getHyperliquidBalance();
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
                hyperliquidChain: config_1.default.hyperliquidChain,
                destination: destinationAddress,
                amount: amount.toString(),
                time: timestamp
            };
            // Sign the message using EIP-712
            const signature = yield wallet._signTypedData(domain, types, message);
            // Extract r, s, v from signature
            const sig = ethers_1.ethers.utils.splitSignature(signature);
            // Make the API request to send USDC
            const response = yield axios_1.default.post(`${API_BASE_URL}/exchange`, {
                action: {
                    type: 'usdSend',
                    hyperliquidChain: config_1.default.hyperliquidChain,
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
                const txHash = ethers_1.ethers.utils.id(`${wallet.address}-${destinationAddress}-${amount}-${timestamp}`);
                return txHash;
            }
            else {
                throw new Error(`Failed to send USDC: ${JSON.stringify(response.data)}`);
            }
        }
        catch (error) {
            console.error('Error sending USDC on Hyperliquid:', error);
            throw error;
        }
    });
}
