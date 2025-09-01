import { PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL, ComputeBudgetProgram } from '@solana/web3.js';
import { schema } from './get-transfer-transaction.schema.js';
import { getConnection } from '../../core/solana/connection.js';
import { ApiError } from '../../core/errors/api-error.js';

/**
 * @typedef {import('express').Request} Request
 * @typedef {import('express').Response} Response
 */

/**
 * POST /sol/get-transfer-transaction
 * Build an unsigned SystemProgram transfer transaction and return Base64.
 * @param {Request} req
 * @param {Response} res
 */
export async function getTransferTransactionHandler(req, res) {
  const parsed = schema.parse(req.body);

  let fromPk, toPk;
  try {
    fromPk = new PublicKey(parsed.fromPublicKey);
    toPk = new PublicKey(parsed.toPublicKey);
  } catch {
    throw new ApiError('INVALID_INPUT', 'The provided public keys are not valid.', 400);
  }

  const lamports = Math.floor(parsed.amountSol * LAMPORTS_PER_SOL);
  if (!Number.isFinite(lamports) || lamports <= 0) {
    throw new ApiError('INVALID_INPUT', 'amountSol must be a positive number.', 400);
  }

  const connection = getConnection();
  // Optional: ensure recipient will be rent-exempt after this transfer by topping up any shortfall.
  // For a plain system account (0-byte data), use rent-exempt minimum for size=0.
  let rentTopUp = 0;
  if (parsed.rentTopUp !== false) {
    const [minRentExemptLamports, acctInfo] = await Promise.all([
      connection.getMinimumBalanceForRentExemption(0),
      connection.getAccountInfo(toPk, 'confirmed'),
    ]);
    const currentLamports = acctInfo?.lamports ?? 0;
    rentTopUp = Math.max(0, minRentExemptLamports - currentLamports);
  }
  const totalLamports = lamports + rentTopUp;

  const { blockhash } = await connection.getLatestBlockhash('confirmed');
  const tx = new Transaction({ feePayer: fromPk, recentBlockhash: blockhash });
  // Optional priority fee controls (Compute Budget) — insert first
  if (typeof parsed.computeUnits === 'number' || typeof parsed.microLamports === 'number') {
    if (typeof parsed.computeUnits === 'number') {
      tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: parsed.computeUnits }));
    }
    if (typeof parsed.microLamports === 'number') {
      tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: parsed.microLamports }));
    }
  }
  tx.add(SystemProgram.transfer({ fromPubkey: fromPk, toPubkey: toPk, lamports: totalLamports }));
  const serialized = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
  const unsignedTx = Buffer.from(serialized).toString('base64');

  return res.status(200).json({ ok: true, data: { unsignedTx } });
}
