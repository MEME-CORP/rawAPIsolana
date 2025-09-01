import { schema } from './get-buy-transaction.schema.js';
import { ApiError } from '../../core/errors/api-error.js';

/**
 * @typedef {import('express').Request} Request
 * @typedef {import('express').Response} Response
 */

const PUMP_PORTAL_TRADE_LOCAL_ENDPOINT = 'https://pumpportal.fun/api/trade-local';
const DEFAULT_PRIORITY_FEE_SOL = 0.0005; // internal default

/** @param {Request} req @param {Response} res */
export async function getBuyTransactionHandler(req, res) {
  const parsed = schema.parse(req.body);
  const priorityFeeSol = parsed.priorityFeeSol ?? DEFAULT_PRIORITY_FEE_SOL;

  const body = {
    publicKey: parsed.buyerPublicKey,
    action: 'buy',
    mint: parsed.mintAddress,
    denominatedInSol: 'true',
    amount: parsed.solAmount,
    slippage: parsed.slippageBps / 100, // bps -> percent
    priorityFee: priorityFeeSol,
    pool: 'pump',
  };

  let resp;
  try {
    resp = await fetch(PUMP_PORTAL_TRADE_LOCAL_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new ApiError('UPSTREAM_ERROR', `Failed to reach Pump Portal: ${e.message}`, 502);
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new ApiError('UPSTREAM_ERROR', `Pump Portal error ${resp.status}: ${text || 'Unknown'}`, 502);
  }

  const buf = Buffer.from(await resp.arrayBuffer());
  const unsignedTx = buf.toString('base64');
  return res.status(200).json({ ok: true, data: { unsignedTx } });
}
