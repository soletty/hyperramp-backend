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
const express_1 = require("express");
const onrampService_1 = require("../services/onrampService");
const router = (0, express_1.Router)();
// Maximum amount allowed for onramp (in USD cents)
const MAX_AMOUNT_USD_CENTS = 250000; // $2,500.00
const MIN_AMOUNT_USD_CENTS = 500; // $5.00
// Get onramp capacity route with explicit CORS handling
router.options('/capacity', (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', 'https://hyperramp.xyz');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With, Content-Type, Accept, Authorization, stripe-signature');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.status(200).end();
});
router.get('/capacity', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', 'https://hyperramp.xyz');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With, Content-Type, Accept, Authorization, stripe-signature');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
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
}));
exports.default = router;
