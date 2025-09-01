import express from 'express';
import { errorHandler } from './core/middleware/error-handler.js';
import { ApiError } from './core/errors/api-error.js';

// Wallet feature
import { createWalletHandler } from './features/wallet/create-wallet.handler.js';
import { getSolBalanceHandler } from './features/wallet/get-sol-balance.handler.js';
// SPL feature
import { getSplBalanceHandler } from './features/spl/get-balance.handler.js';
// SOL feature
import { getTransferTransactionHandler } from './features/sol/get-transfer-transaction.handler.js';
import { advancedTransferHandler } from './features/sol-advanced/advanced-transfer.handler.js';
// Blockchain feature
import { sendTransactionHandler } from './features/blockchain/send-transaction.handler.js';
import { getTransactionStatusHandler } from './features/blockchain/get-transaction-status.handler.js';
import { signTransactionHandler } from './features/blockchain/sign-transaction.handler.js';
// Pump.fun feature
import { getBuyTransactionHandler } from './features/pump/get-buy-transaction.handler.js';
import { getSellTransactionHandler } from './features/pump/get-sell-transaction.handler.js';
import { getCreateTransactionHandler } from './features/pump/get-create-transaction.handler.js';
// Pump.fun Advanced feature
import { createAdvancedHandler } from './features/pump-advanced/create-advanced.handler.js';
import { buyAdvancedHandler } from './features/pump-advanced/buy-advanced.handler.js';
import { sellAdvancedHandler } from './features/pump-advanced/sell-advanced.handler.js';
// Upload feature
import { uploadPinataImageHandler } from './features/upload/upload-pinata-image.handler.js';

const app = express();
// Allow larger JSON payloads for base64 images (Upload feature)
app.use(express.json({ limit: '10mb' }));

// Base router for /api/v1 per OpenAPI
const v1 = express.Router();

// Wallet routes
v1.post('/wallet/create', createWalletHandler);
v1.get('/wallet/:publicKey/balance/sol', getSolBalanceHandler);
// SPL routes
v1.get('/spl/:mintAddress/balance/:walletPublicKey', getSplBalanceHandler);
// SOL routes
v1.post('/sol/get-transfer-transaction', getTransferTransactionHandler);
v1.post('/sol/advanced-transfer', advancedTransferHandler);
// Pump.fun routes
v1.post('/pump/get-create-transaction', getCreateTransactionHandler);
v1.post('/pump/get-buy-transaction', getBuyTransactionHandler);
v1.post('/pump/get-sell-transaction', getSellTransactionHandler);
// Pump.fun Advanced routes
v1.post('/pump/advanced-create', createAdvancedHandler);
v1.post('/pump/advanced-buy', buyAdvancedHandler);
v1.post('/pump/advanced-sell', sellAdvancedHandler);
// Upload routes
v1.post('/upload/pinata-image', uploadPinataImageHandler);
// Blockchain routes
v1.post('/blockchain/send-transaction', sendTransactionHandler);
v1.get('/blockchain/transaction-status/:signature', getTransactionStatusHandler);
v1.post('/blockchain/sign-transaction', signTransactionHandler);

// Mount under /api/v1
app.use('/api/v1', v1);

// Root health
app.get('/', (req, res) => {
  res.json({ ok: true, data: { service: 'Blockchain Primitives API', version: '1.0.0' } });
});

// 404 for unmatched /api/v1 routes
app.use('/api/v1', (req, res, next) => {
  next(new ApiError('NOT_FOUND', 'Resource not found', 404));
});

// Centralized error handler
app.use(errorHandler);

export default app;



