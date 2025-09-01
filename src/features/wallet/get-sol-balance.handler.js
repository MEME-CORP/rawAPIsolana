import { PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { schema } from './get-sol-balance.schema.js';
import { getConnection } from '../../core/solana/connection.js';
import { ApiError } from '../../core/errors/api-error.js';

/**
 * @typedef {import('express').Request} Request
 * @typedef {import('express').Response} Response
 */

/** @param {Request} req @param {Response} res */
export async function getSolBalanceHandler(req, res) {
  const parsed = schema.parse({ publicKey: req.params.publicKey });

  let pubkey;
  try {
    pubkey = new PublicKey(parsed.publicKey);
  } catch {
    throw new ApiError('INVALID_INPUT', 'The provided public key is not valid.', 400);
  }

  const connection = getConnection();
  const lamports = await connection.getBalance(pubkey, 'confirmed');
  const balanceSol = lamports / LAMPORTS_PER_SOL;

  return res.status(200).json({
    ok: true,
    data: {
      publicKey: pubkey.toBase58(),
      balanceSol,
      balanceLamports: String(lamports),
    },
  });
}
