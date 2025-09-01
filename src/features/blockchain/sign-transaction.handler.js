import { Keypair, Transaction, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';
import { schema } from './sign-transaction.schema.js';
import { ApiError } from '../../core/errors/api-error.js';

/**
 * @typedef {import('express').Request} Request
 * @typedef {import('express').Response} Response
 */

/**
 * POST /blockchain/sign-transaction
 * Accepts Base64 unsigned tx and a Base58 private key, returns Base64 signed tx.
 * Private key is used only in-memory and never logged or persisted.
 * @param {Request} req
 * @param {Response} res
 */
export async function signTransactionHandler(req, res) {
  const parsed = schema.parse(req.body);

  // Decode private key (Base58 -> Uint8Array secret key)
  let signer;
  try {
    const secretKey = bs58.decode(parsed.privateKey);
    if (!secretKey || secretKey.length < 64) {
      throw new Error('Secret key must be 64 bytes');
    }
    signer = Keypair.fromSecretKey(secretKey);
  } catch {
    throw new ApiError('INVALID_INPUT', 'privateKey must be a valid Base58-encoded secret key', 400);
  }

  // Decode unsigned tx (Base64 -> Buffer)
  let raw;
  try {
    raw = Buffer.from(parsed.unsignedTx, 'base64');
    if (!raw || raw.length === 0) throw new Error('Empty');
  } catch {
    throw new ApiError('INVALID_INPUT', 'unsignedTx must be a valid Base64 string', 400);
  }

  // Try legacy Transaction first, then v0 VersionedTransaction
  let signedTxBase64;
  try {
    const tx = Transaction.from(raw);
    // Ensure signer matches fee payer to avoid zero-signature transactions
    if (tx.feePayer && !tx.feePayer.equals(signer.publicKey)) {
      throw new ApiError(
        'INVALID_INPUT',
        'privateKey does not match the transaction fee payer',
        400
      );
    }
    tx.sign(signer);
    const serialized = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
    signedTxBase64 = Buffer.from(serialized).toString('base64');
  } catch (e1) {
    try {
      const vtx = VersionedTransaction.deserialize(raw);
      vtx.sign([signer]);
      const serialized = vtx.serialize();
      signedTxBase64 = Buffer.from(serialized).toString('base64');
    } catch (e2) {
      throw new ApiError('INVALID_INPUT', 'unsignedTx is not a valid serialized transaction (legacy or v0)', 400);
    }
  }

  return res.status(200).json({ ok: true, data: { signedTx: signedTxBase64 } });
}
