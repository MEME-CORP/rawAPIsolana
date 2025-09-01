import { Keypair, Transaction, VersionedTransaction, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import { schema } from './sell-advanced.schema.js';
import { getConnection } from '../../core/solana/connection.js';
import { confirmSignature } from '../../core/solana/rpc-config.js';
import { ApiError } from '../../core/errors/api-error.js';

/**
 * @typedef {import('express').Request} Request
 * @typedef {import('express').Response} Response
 */

const PUMP_PORTAL_TRADE_LOCAL_ENDPOINT = 'https://pumpportal.fun/api/trade-local';
const DEFAULT_PRIORITY_FEE_SOL = 0.0005; // internal default

/**
 * POST /pump/advanced-sell
 * Build unsigned Pump.fun sell tx, sign with provided private key, send, confirm, and return post SOL+SPL balances.
 * Returns { signature, confirmed, commitment, unsignedTx, postBalances: { sol, spl } }
 *
 * SECURITY: Accepts Base58 privateKey strictly to sign this transaction in-memory. Never persisted or logged.
 *
 * @param {Request} req
 * @param {Response} res
 */
export async function sellAdvancedHandler(req, res) {
  const parsed = schema.parse(req.body);
  const priorityFeeSol = parsed.priorityFeeSol ?? DEFAULT_PRIORITY_FEE_SOL;

  // Decode signer and validate it matches sellerPublicKey
  let signer, sellerPk, mintPk;
  try {
    sellerPk = new PublicKey(parsed.sellerPublicKey);
    mintPk = new PublicKey(parsed.mintAddress);
  } catch {
    throw new ApiError('INVALID_INPUT', 'sellerPublicKey or mintAddress is not valid', 400);
  }
  try {
    const secretKey = bs58.decode(parsed.privateKey);
    if (!secretKey || secretKey.length < 64) throw new Error('Invalid secret key length');
    signer = Keypair.fromSecretKey(secretKey);
    if (!sellerPk.equals(signer.publicKey)) {
      throw new ApiError('INVALID_INPUT', 'privateKey does not match sellerPublicKey (fee payer)', 400);
    }
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError('INVALID_INPUT', 'privateKey must be a valid Base58-encoded secret key', 400);
  }

  // tokenAmount can be a percentage string like "100%" or a numeric token amount.
  let amountForPortal = parsed.tokenAmount;
  const trimmed = parsed.tokenAmount.trim();
  if (!trimmed.endsWith('%')) {
    const asNum = Number(trimmed);
    if (!Number.isFinite(asNum) || asNum <= 0) {
      throw new ApiError('INVALID_INPUT', 'tokenAmount must be a positive token amount or a percentage string like "100%"', 400);
    }
    amountForPortal = asNum;
  }

  // 1) Request unsigned sell tx from Pump Portal
  const body = {
    publicKey: sellerPk.toBase58(),
    action: 'sell',
    mint: mintPk.toBase58(),
    denominatedInSol: 'false',
    amount: amountForPortal,
    slippage: parsed.slippageBps / 100,
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

  // 2) Sign
  let signedRaw;
  try {
    const raw = Buffer.from(unsignedTx, 'base64');
    try {
      const tx = Transaction.from(raw);
      if (tx.feePayer && !tx.feePayer.equals(signer.publicKey)) {
        throw new ApiError('INVALID_INPUT', 'privateKey does not match transaction fee payer', 400);
      }
      tx.sign(signer);
      signedRaw = tx.serialize({ requireAllSignatures: true, verifySignatures: true });
    } catch (e1) {
      const vtx = VersionedTransaction.deserialize(raw);
      vtx.sign([signer]);
      signedRaw = vtx.serialize();
    }
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError('INVALID_INPUT', 'unsignedTx is not a valid serialized transaction (legacy or v0)', 400);
  }

  const connection = getConnection();

  // 3) Validate blockhash is still valid
  try {
    let blockhash = null;
    try {
      const tx = Transaction.from(signedRaw);
      blockhash = tx.recentBlockhash || null;
    } catch (_) {
      try {
        const vtx = VersionedTransaction.deserialize(signedRaw);
        blockhash = vtx.message.recentBlockhash || null;
      } catch (_) {}
    }
    if (blockhash) {
      const stillValid = await connection.isBlockhashValid(blockhash, 'confirmed');
      if (!stillValid) {
        throw new ApiError('INVALID_INPUT', 'Signed transaction uses an expired blockhash. Please rebuild and re-sign.', 400);
      }
    }
  } catch (e) {
    if (e instanceof ApiError) throw e;
  }

  // 4) Send & confirm
  let signature;
  try {
    signature = await connection.sendRawTransaction(signedRaw, { skipPreflight: false, preflightCommitment: 'confirmed' });
  } catch (e) {
    throw new ApiError('UPSTREAM_ERROR', `sendRawTransaction failed: ${e.message}`, 502);
  }
  const commitment = parsed.commitment || 'confirmed';
  const confirmed = await confirmSignature(connection, signature, commitment);

  // 5) Post balances (SOL + SPL)
  const lamports = await connection.getBalance(sellerPk, 'confirmed');
  const solPost = {
    publicKey: sellerPk.toBase58(),
    balanceSol: lamports / 1_000_000_000,
    balanceLamports: String(lamports),
  };

  let splPost = { walletPublicKey: sellerPk.toBase58(), mintAddress: mintPk.toBase58(), uiAmount: 0, rawAmount: '0' };
  try {
    const respTok = await connection.getParsedTokenAccountsByOwner(sellerPk, { mint: mintPk }, 'confirmed');
    if (respTok?.value?.length > 0) {
      const t = respTok.value[0].account.data.parsed.info.tokenAmount;
      const amountStr = String(t.amount ?? '0');
      const decimals = Number(t.decimals ?? 0);
      let uiAmount = 0;
      if (typeof t.uiAmount === 'number' && Number.isFinite(t.uiAmount)) {
        uiAmount = t.uiAmount;
      } else if (typeof t.uiAmountString === 'string') {
        const n = Number(t.uiAmountString);
        uiAmount = Number.isFinite(n) ? n : 0;
      } else {
        const n = Number(amountStr);
        uiAmount = Number.isFinite(n) && decimals >= 0 ? n / Math.pow(10, decimals) : 0;
      }
      splPost = { walletPublicKey: sellerPk.toBase58(), mintAddress: mintPk.toBase58(), uiAmount, rawAmount: amountStr };
    }
  } catch (_) {}

  return res.status(200).json({
    ok: true,
    data: {
      signature,
      confirmed,
      commitment,
      unsignedTx,
      postBalances: { sol: solPost, spl: splPost },
    },
  });
}
