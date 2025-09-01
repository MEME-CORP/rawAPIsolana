import { schema } from './get-create-transaction.schema.js';
import { ApiError } from '../../core/errors/api-error.js';

/**
 * @typedef {import('express').Request} Request
 * @typedef {import('express').Response} Response
 */

const PUMP_PORTAL_TRADE_LOCAL_ENDPOINT = 'https://pumpportal.fun/api/trade-local';
const DEFAULT_PRIORITY_FEE_SOL = 0.0005; // internal default

/**
 * POST /pump/get-create-transaction
 * Build an unsigned Pump.fun create transaction via Pump Portal and return Base64 serialized tx.
 * If metadataUri is not provided, this handler will construct minimal JSON metadata and upload it to Pinata.
 *
 * Security: No private keys are accepted. This endpoint returns an unsigned transaction only.
 *
 * @param {Request} req
 * @param {Response} res
 */
export async function getCreateTransactionHandler(req, res) {
  const parsed = schema.parse(req.body);

  // 1) Ensure we have a metadata URI. If not provided, upload JSON metadata to Pinata.
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

    // Minimal Metaplex-compatible JSON metadata
    /** @type {Record<string, any>} */
    const metadataJson = {
      name: parsed.name,
      symbol: parsed.symbol,
      description: parsed.description,
      image: parsed.imageUrl, // external URL ok; can be an ipfs:// link if caller prefers
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
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${pinataJwt}`,
        },
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
    metadataUri = `ipfs://${pinJson.IpfsHash}`;
  }

  // 2) Request unsigned create tx from Pump Portal
  const body = {
    publicKey: parsed.creatorPublicKey,
    action: 'create',
    tokenMetadata: {
      name: parsed.name,
      symbol: parsed.symbol,
      uri: metadataUri,
    },
    mint: parsed.mintPublicKey,
    denominatedInSol: 'true',
    amount: parsed.devBuyAmount,
    slippage: parsed.slippageBps / 100, // bps -> percent
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
  return res.status(200).json({ ok: true, data: { unsignedTx } });
}
