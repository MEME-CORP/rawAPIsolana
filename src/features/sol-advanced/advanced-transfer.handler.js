import { PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL, ComputeBudgetProgram, Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { schema } from './advanced-transfer.schema.js';
import { getConnection } from '../../core/solana/connection.js';
import { confirmSignature } from '../../core/solana/rpc-config.js';
import { ApiError } from '../../core/errors/api-error.js';

/**
 * @typedef {import('express').Request} Request
 * @typedef {import('express').Response} Response
 */

/**
 * POST /sol/advanced-transfer
 * Build, sign, send, and confirm a SOL transfer in one call.
 * Also returns pre/post balances and whether rent top-up was applied (only when recipient had 0 SOL).
 *
 * SECURITY: Accepts a Base58 privateKey strictly to sign this transaction in-memory. Never persisted or logged.
 *
 * @param {Request} req
 * @param {Response} res
 */
export async function advancedTransferHandler(req, res) {
  const parsed = schema.parse(req.body);

  // Parse keys
  let fromPk, toPk, signer;
  try {
    fromPk = new PublicKey(parsed.fromPublicKey);
    toPk = new PublicKey(parsed.toPublicKey);
  } catch {
    throw new ApiError('INVALID_INPUT', 'The provided public keys are not valid.', 400);
  }
  try {
    const secretKey = bs58.decode(parsed.privateKey);
    if (!secretKey || secretKey.length < 64) throw new Error('Invalid secret key length');
    signer = Keypair.fromSecretKey(secretKey);
    if (!fromPk.equals(signer.publicKey)) {
      throw new ApiError('INVALID_INPUT', 'privateKey does not match fromPublicKey (fee payer)', 400);
    }
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError('INVALID_INPUT', 'privateKey must be a valid Base58-encoded secret key', 400);
  }

  // Amount
  const lamports = Math.floor(parsed.amountSol * LAMPORTS_PER_SOL);
  if (!Number.isFinite(lamports) || lamports <= 0) {
    throw new ApiError('INVALID_INPUT', 'amountSol must be a positive number.', 400);
  }

  const connection = getConnection();

  // Pre balances
  const [fromBefore, toBefore] = await Promise.all([
    connection.getBalance(fromPk, 'confirmed'),
    connection.getBalance(toPk, 'confirmed'),
  ]);

  // Minimum meaningful balance gate (0.001 SOL)
  const MIN_RELEVANT_BALANCE_LAMPORTS = 1_000_000;
  if (fromBefore < MIN_RELEVANT_BALANCE_LAMPORTS) {
    throw new ApiError('INSUFFICIENT_FUNDS', 'Account balance too low (min 0.001 SOL required to perform a relevant transaction).', 400);
  }

  // Rent top-up only if recipient currently has 0 lamports
  let rentTopUpLamports = 0;
  if (toBefore === 0) {
    const minRent = await connection.getMinimumBalanceForRentExemption(0);
    rentTopUpLamports = minRent; // top-up to rent-exempt threshold for empty system account
  }

  // Latest blockhash (also used for fee estimation)
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');

  // Estimate base fee for this message
  const feeEstTx = new Transaction({ feePayer: fromPk, recentBlockhash: blockhash });
  if (typeof parsed.computeUnits === 'number') {
    feeEstTx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: parsed.computeUnits }));
  }
  if (typeof parsed.microLamports === 'number') {
    feeEstTx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: parsed.microLamports }));
  }
  feeEstTx.add(SystemProgram.transfer({ fromPubkey: fromPk, toPubkey: toPk, lamports: 1 }));
  let baseFeeLamports = 5000;
  try {
    const est = await connection.getFeeForMessage(feeEstTx.compileMessage());
    if (typeof est === 'number' && est > 0) baseFeeLamports = est;
  } catch {}

  // Estimate priority fee (lamports) from micro-lamports per CU
  const priorityFeeLamports = (typeof parsed.computeUnits === 'number' && typeof parsed.microLamports === 'number')
    ? Math.floor((parsed.computeUnits * parsed.microLamports) / 1_000_000)
    : 0;

  // Adjust transfer amount to fit available funds after rent and fees
  const availableLamports = fromBefore;
  const fixedCostsLamports = baseFeeLamports + priorityFeeLamports + rentTopUpLamports;
  let finalTransferLamports = lamports;
  if (availableLamports < fixedCostsLamports + finalTransferLamports) {
    finalTransferLamports = Math.floor(availableLamports - fixedCostsLamports);
    if (!Number.isFinite(finalTransferLamports) || finalTransferLamports <= 0) {
      throw new ApiError('INSUFFICIENT_FUNDS', 'Insufficient funds after fees/rent; nothing left to transfer.', 400);
    }
  }
  const totalLamports = finalTransferLamports + rentTopUpLamports;

  // Build transaction
  const tx = new Transaction({ feePayer: fromPk, recentBlockhash: blockhash });
  if (typeof parsed.computeUnits === 'number') {
    tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: parsed.computeUnits }));
  }
  if (typeof parsed.microLamports === 'number') {
    tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: parsed.microLamports }));
  }
  tx.add(SystemProgram.transfer({ fromPubkey: fromPk, toPubkey: toPk, lamports: totalLamports }));

  // Sign
  tx.sign(signer);
  const raw = tx.serialize({ requireAllSignatures: true, verifySignatures: true });

  // Send
  let signature;
  try {
    signature = await connection.sendRawTransaction(raw, { skipPreflight: false, preflightCommitment: 'confirmed' });
  } catch (e) {
    throw new ApiError('UPSTREAM_ERROR', `sendRawTransaction failed: ${e.message}`, 502);
  }

  // Confirm
  const commitment = parsed.commitment || 'confirmed';
  const confirmed = await confirmSignature(connection, signature, commitment);

  // Post balances
  const [fromAfter, toAfter] = await Promise.all([
    connection.getBalance(fromPk, 'confirmed'),
    connection.getBalance(toPk, 'confirmed'),
  ]);

  return res.status(200).json({
    ok: true,
    data: {
      signature,
      confirmed,
      commitment,
      preBalances: {
        fromLamports: String(fromBefore),
        toLamports: String(toBefore),
        fromSol: fromBefore / LAMPORTS_PER_SOL,
        toSol: toBefore / LAMPORTS_PER_SOL,
      },
      transfer: {
        amountLamports: String(finalTransferLamports),
        rentTopUpLamports: String(rentTopUpLamports),
        totalLamports: String(totalLamports),
      },
      postBalances: {
        fromLamports: String(fromAfter),
        toLamports: String(toAfter),
        fromSol: fromAfter / LAMPORTS_PER_SOL,
        toSol: toAfter / LAMPORTS_PER_SOL,
      },
      blockhashInfo: { blockhash, lastValidBlockHeight },
    },
  });
}
