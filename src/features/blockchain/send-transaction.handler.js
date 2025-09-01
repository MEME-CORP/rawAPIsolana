import { schema } from './send-transaction.schema.js';
import { getConnection } from '../../core/solana/connection.js';
import { ApiError } from '../../core/errors/api-error.js';
import { confirmSignature } from '../../core/solana/rpc-config.js';
import { Transaction, VersionedTransaction } from '@solana/web3.js';

/**
 * @typedef {import('express').Request} Request
 * @typedef {import('express').Response} Response
 */

/**
 * POST /blockchain/send-transaction
 * Accepts Base64 signed tx, sends to chain, attempts confirmation, returns signature.
 * @param {Request} req
 * @param {Response} res
 */
export async function sendTransactionHandler(req, res) {
  const parsed = schema.parse(req.body);

  let raw;
  try {
    raw = Buffer.from(parsed.signedTx, 'base64');
    if (!raw || raw.length === 0) throw new Error('Empty');
  } catch {
    throw new ApiError('INVALID_INPUT', 'signedTx must be a valid Base64 string', 400);
  }

  // Extract recent blockhash from the signed transaction and ensure it is still valid
  // to avoid broadcasting an expired transaction that would never confirm.
  let blockhash = null;
  try {
    const tx = Transaction.from(raw);
    blockhash = tx.recentBlockhash || null;
  } catch {
    try {
      const vtx = VersionedTransaction.deserialize(raw);
      blockhash = vtx.message.recentBlockhash || null;
    } catch (_) {
      // If neither legacy nor v0 parses, treat as invalid input
      throw new ApiError('INVALID_INPUT', 'signedTx is not a valid serialized transaction (legacy or v0)', 400);
    }
  }

  const connection = getConnection();
  if (blockhash) {
    const stillValid = await connection.isBlockhashValid(blockhash, 'confirmed');
    if (!stillValid) {
      throw new ApiError(
        'INVALID_INPUT',
        'Signed transaction uses an expired blockhash. Please rebuild and re-sign.',
        400
      );
    }
  }

  // Primary send with small built-in retries (node-level)
  const signature = await connection.sendRawTransaction(raw, {
    skipPreflight: true,
    preflightCommitment: 'confirmed',
    maxRetries: 3,
  });

  // Best-effort confirmation
  let confirmed = await confirmSignature(connection, signature, 'confirmed');

  // If not yet confirmed, re-broadcast a couple times to aid propagation
  if (!confirmed) {
    for (let i = 0; i < 2 && !confirmed; i++) {
      try {
        await connection.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 });
      } catch (_) {
        // Ignore re-broadcast errors (e.g., AlreadyProcessed)
      }
      // Short wait then re-check
      await new Promise((r) => setTimeout(r, 600));
      confirmed = await confirmSignature(connection, signature, 'confirmed');
    }
  }

  return res.status(200).json({ ok: true, data: { signature } });
}

