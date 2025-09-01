import { PublicKey } from '@solana/web3.js';
import { schema } from './get-balance.schema.js';
import { getConnection } from '../../core/solana/connection.js';
import { ApiError } from '../../core/errors/api-error.js';

/**
 * @typedef {import('express').Request} Request
 * @typedef {import('express').Response} Response
 */

/**
 * GET /spl/{mintAddress}/balance/{walletPublicKey}
 * @param {Request} req
 * @param {Response} res
 */
export async function getSplBalanceHandler(req, res) {
  const parsed = schema.parse({
    mintAddress: req.params.mintAddress,
    walletPublicKey: req.params.walletPublicKey,
  });

  let ownerPk, mintPk;
  try {
    ownerPk = new PublicKey(parsed.walletPublicKey);
    mintPk = new PublicKey(parsed.mintAddress);
  } catch {
    throw new ApiError('INVALID_INPUT', 'The provided public key or mint address is not valid.', 400);
  }

  const connection = getConnection();

  const resp = await connection.getParsedTokenAccountsByOwner(ownerPk, { mint: mintPk }, 'confirmed');

  let rawAmount = '0';
  let uiAmount = 0;

  if (resp?.value?.length > 0) {
    const tokenAmount = resp.value[0].account.data.parsed.info.tokenAmount;
    const amountStr = String(tokenAmount.amount ?? '0');
    const decimals = Number(tokenAmount.decimals ?? 0);
    rawAmount = amountStr;

    if (typeof tokenAmount.uiAmount === 'number' && Number.isFinite(tokenAmount.uiAmount)) {
      uiAmount = tokenAmount.uiAmount;
    } else if (typeof tokenAmount.uiAmountString === 'string') {
      const n = Number(tokenAmount.uiAmountString);
      uiAmount = Number.isFinite(n) ? n : 0;
    } else {
      const n = Number(amountStr);
      uiAmount = Number.isFinite(n) && decimals >= 0 ? n / Math.pow(10, decimals) : 0;
    }
  }

  return res.status(200).json({
    ok: true,
    data: {
      walletPublicKey: ownerPk.toBase58(),
      mintAddress: mintPk.toBase58(),
      uiAmount,
      rawAmount,
    },
  });
}
