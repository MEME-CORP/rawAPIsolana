import { Keypair, Transaction, VersionedTransaction, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import { schema } from './create-advanced.schema.js';
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
 * POST /pump/advanced-create
 * Build unsigned Pump.fun create tx, sign with provided private key, send, confirm, and return post SOL+SPL balance.
 * Returns { signature, confirmed, commitment, unsignedTx, postBalances: { sol, spl } }
 *
 * SECURITY: Accepts Base58 privateKey strictly to sign this transaction in-memory. Never persisted or logged.
 *
 * @param {Request} req
 * @param {Response} res
 */
export async function createAdvancedHandler(req, res) {
  const parsed = schema.parse(req.body);

  // Decode signer and validate it matches creatorPublicKey
  let signer, creatorPk;
  try {
    creatorPk = new PublicKey(parsed.creatorPublicKey);
  } catch {
    throw new ApiError('INVALID_INPUT', 'creatorPublicKey is not valid', 400);
  }
  try {
    const secretKey = bs58.decode(parsed.privateKey);
    if (!secretKey || secretKey.length < 64) throw new Error('Invalid secret key length');
    signer = Keypair.fromSecretKey(secretKey);
    if (!creatorPk.equals(signer.publicKey)) {
      throw new ApiError('INVALID_INPUT', 'privateKey does not match creatorPublicKey (fee payer)', 400);
    }
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError('INVALID_INPUT', 'privateKey must be a valid Base58-encoded secret key', 400);
  }

  // Decode mint signer and validate it matches mintPublicKey, or generate if omitted
  let mintSigner, mintPk;
  let mintWasGenerated = false;
  if (parsed.mintPublicKey && parsed.mintPrivateKey) {
    try {
      mintPk = new PublicKey(parsed.mintPublicKey);
    } catch {
      throw new ApiError('INVALID_INPUT', 'mintPublicKey is not valid', 400);
    }
    try {
      const mintSecret = bs58.decode(parsed.mintPrivateKey);
      if (!mintSecret || mintSecret.length < 64) throw new Error('Invalid mint secret key length');
      mintSigner = Keypair.fromSecretKey(mintSecret);
      if (!mintPk.equals(mintSigner.publicKey)) {
        throw new ApiError('INVALID_INPUT', 'mintPrivateKey does not match mintPublicKey', 400);
      }
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw new ApiError('INVALID_INPUT', 'mintPrivateKey must be a valid Base58-encoded secret key', 400);
    }
  } else {
    // No mint keys provided: generate a fresh mint keypair (in-memory only)
    mintSigner = Keypair.generate();
    mintPk = mintSigner.publicKey;
    mintWasGenerated = true;
  }

  // Ensure metadataUri (optionally upload minimal JSON to Pinata)
  let metadataUri = parsed.metadataUri;
  if (!metadataUri) {
    const pinataJwt = process.env.PINATA_JWT;
    if (!pinataJwt) {
      throw new ApiError(
        'INVALID_INPUT',
        'metadataUri is required when PINATA_JWT is not configured. Either supply metadataUri or set PINATA_JWT.',
        400
      );
    }

    /** @type {Record<string, any>} */
    const metadataJson = {
      name: parsed.name,
      symbol: parsed.symbol,
      description: parsed.description,
      image: parsed.imageUrl,
      external_url: parsed.website || undefined,
      properties: {
        category: 'image',
        files: parsed.imageUrl ? [{ uri: parsed.imageUrl, type: 'image' }] : [],
      },
      extensions: {
        twitter: parsed.twitter || undefined,
        telegram: parsed.telegram || undefined,
        website: parsed.website || undefined,
      },
    };

    let pinResp;
    try {
      pinResp = await fetch('https://api.pinata.cloud/pinning/pinJSONToIPFS', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${pinataJwt}` },
        body: JSON.stringify({ pinataContent: metadataJson }),
      });
    } catch (e) {
      throw new ApiError('UPSTREAM_ERROR', `Failed to reach Pinata: ${e.message}`, 502);
    }
    if (!pinResp.ok) {
      const text = await pinResp.text().catch(() => '');
      throw new ApiError('UPSTREAM_ERROR', `Pinata error ${pinResp.status}: ${text || 'Unknown'}`, 502);
    }
    /** @type {{ IpfsHash?: string }} */
    const pinJson = await pinResp.json().catch(() => ({}));
    if (!pinJson || !pinJson.IpfsHash) {
      throw new ApiError('UPSTREAM_ERROR', 'Pinata did not return IpfsHash', 502);
    }
    // Prefer HTTP gateway URL for better downstream compatibility
    metadataUri = `https://ipfs.io/ipfs/${pinJson.IpfsHash}`;
  }

  // Normalize provided metadataUri if using ipfs:// to an HTTP gateway for Pump Portal
  let uriForPump = metadataUri;
  if (typeof uriForPump === 'string' && uriForPump.startsWith('ipfs://')) {
    uriForPump = `https://ipfs.io/ipfs/${uriForPump.slice('ipfs://'.length)}`;
  }

  // Lightweight availability check to mitigate IPFS propagation lag.
  // Try ipfs.io first, then pinata gateway. Use the first that responds OK.
  async function checkUrlOk(url) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 2500);
    try {
      const head = await fetch(url, { method: 'HEAD', signal: controller.signal });
      if (head.ok) return true;
    } catch {}
    try {
      const get = await fetch(url, { method: 'GET', signal: controller.signal });
      return get.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(t);
    }
  }

  const candidates = [];
  if (typeof uriForPump === 'string') {
    candidates.push(uriForPump);
    const cidMatch = uriForPump.match(/ipfs\.(?:io|gateway\.pinata\.cloud)\/ipfs\/([^/?#]+)/);
    if (!cidMatch && uriForPump.startsWith('https://ipfs.io/ipfs/')) {
      // already ipfs.io
      const cid = uriForPump.slice('https://ipfs.io/ipfs/'.length).split('/')[0];
      candidates.push(`https://gateway.pinata.cloud/ipfs/${cid}`);
    } else if (cidMatch) {
      const cid = cidMatch[1];
      candidates.push(`https://ipfs.io/ipfs/${cid}`);
      candidates.push(`https://gateway.pinata.cloud/ipfs/${cid}`);
    }
  }

  for (const url of candidates) {
    // Select the first accessible candidate
    try {
      const ok = await checkUrlOk(url);
      if (ok) { uriForPump = url; break; }
    } catch {}
  }

  // Request unsigned create tx from Pump Portal
  const body = {
    publicKey: parsed.creatorPublicKey,
    action: 'create',
    tokenMetadata: { name: parsed.name, symbol: parsed.symbol, uri: uriForPump },
    mint: mintPk.toBase58(),
    denominatedInSol: 'true',
    amount: parsed.devBuyAmount,
    slippage: parsed.slippageBps / 100,
    priorityFee: parsed.priorityFeeSol ?? DEFAULT_PRIORITY_FEE_SOL,
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

  // Sign (legacy or v0)
  let signedRaw;
  try {
    const raw = Buffer.from(unsignedTx, 'base64');
    try {
      const tx = Transaction.from(raw);
      // feePayer check if present
      if (tx.feePayer && !tx.feePayer.equals(signer.publicKey)) {
        throw new ApiError('INVALID_INPUT', 'privateKey does not match transaction fee payer', 400);
      }
      // Sign with both creator and mint
      tx.sign(signer, mintSigner);
      signedRaw = tx.serialize({ requireAllSignatures: true, verifySignatures: true });
    } catch (e1) {
      const vtx = VersionedTransaction.deserialize(raw);
      // Sign with both creator and mint keypairs
      vtx.sign([signer, mintSigner]);
      signedRaw = vtx.serialize();
    }
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError('INVALID_INPUT', 'unsignedTx is not a valid serialized transaction (legacy or v0)', 400);
  }

  const connection = getConnection();

  // Extract and validate recent blockhash to avoid broadcasting expired tx
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

  // Send & confirm
  let signature;
  try {
    signature = await connection.sendRawTransaction(signedRaw, { skipPreflight: false, preflightCommitment: 'confirmed' });
  } catch (e) {
    throw new ApiError('UPSTREAM_ERROR', `sendRawTransaction failed: ${e.message}`, 502);
  }
  const commitment = parsed.commitment || 'confirmed';
  const confirmed = await confirmSignature(connection, signature, commitment);

  // Post balances (SOL + SPL)
  const lamports = await connection.getBalance(creatorPk, 'confirmed');
  const solPost = {
    publicKey: creatorPk.toBase58(),
    balanceSol: lamports / 1_000_000_000,
    balanceLamports: String(lamports),
  };

  const mintPkStr = mintPk.toBase58();
  let splPost = { walletPublicKey: creatorPk.toBase58(), mintAddress: mintPkStr, uiAmount: 0, rawAmount: '0' };
  try {
    const ownerPk = creatorPk;
    const respTok = await connection.getParsedTokenAccountsByOwner(ownerPk, { mint: mintPk }, 'confirmed');
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
      splPost = { walletPublicKey: ownerPk.toBase58(), mintAddress: mintPkStr, uiAmount, rawAmount: amountStr };
    }
  } catch (_) {}

  return res.status(200).json({
    ok: true,
    data: {
      signature,
      confirmed,
      commitment,
      unsignedTx,
      postBalances: {
        sol: solPost,
        spl: splPost,
      },
      ...(mintWasGenerated
        ? {
            generatedMint: {
              publicKey: mintPkStr,
              privateKey: bs58.encode(mintSigner.secretKey),
            },
          }
        : {}),
    },
  });
}
