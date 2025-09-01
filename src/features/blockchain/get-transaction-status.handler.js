import { schema } from './get-transaction-status.schema.js';
import { getConnection } from '../../core/solana/connection.js';
import { ApiError } from '../../core/errors/api-error.js';

/**
 * @typedef {import('express').Request} Request
 * @typedef {import('express').Response} Response
 */

/**
 * GET /blockchain/transaction-status/{signature}
 * Returns { signature, status: pending | confirmed | finalized | failed }
 * @param {Request} req
 * @param {Response} res
 */
export async function getTransactionStatusHandler(req, res) {
  const params = schema.parse(req.params);
  const { signature } = params;

  const connection = getConnection();
  const statuses = await connection.getSignatureStatuses([signature], { searchTransactionHistory: true });
  const value = statuses && statuses.value ? statuses.value[0] : null;

  // If unknown/not found yet, treat as pending
  if (!value) {
    return res.status(200).json({ ok: true, data: { signature, status: 'pending' } });
  }

  let status;
  if (value.err) {
    status = 'failed';
  } else if (value.confirmationStatus === 'finalized') {
    status = 'finalized';
  } else if (value.confirmationStatus === 'confirmed') {
    status = 'confirmed';
  } else {
    status = 'pending';
  }

  return res.status(200).json({ ok: true, data: { signature, status } });
}

