import { schema } from './upload-pinata-image.schema.js';
import { ApiError } from '../../core/errors/api-error.js';

/**
 * @typedef {import('express').Request} Request
 * @typedef {import('express').Response} Response
 */

const PIN_FILE_ENDPOINT = 'https://api.pinata.cloud/pinning/pinFileToIPFS';
const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

/**
 * POST /upload/pinata-image
 * Accepts a base64-encoded image and uploads it to Pinata (no local persistence).
 * Returns ipfs:// URI and CID.
 *
 * Security: Requires PINATA_JWT env var. No disk writes.
 *
 * @param {Request} req
 * @param {Response} res
 */
export async function uploadPinataImageHandler(req, res) {
  const parsed = schema.parse(req.body);

  const pinataJwt = process.env.PINATA_JWT;
  if (!pinataJwt) {
    throw new ApiError('INVALID_INPUT', 'PINATA_JWT must be configured to upload images', 400);
  }

  let { fileName, contentType, imageBase64 } = parsed;

  // Allow data URI input; if provided, parse and strip prefix
  const m = /^data:([^;]+);base64,(.+)$/i.exec(imageBase64);
  if (m) {
    const detectedType = m[1];
    if (detectedType && detectedType.startsWith('image/')) {
      contentType = detectedType;
    }
    imageBase64 = m[2];
  }

  // Decode base64 to binary
  let bytes;
  try {
    bytes = Buffer.from(imageBase64, 'base64');
    if (!bytes || bytes.length === 0) throw new Error('Empty');
  } catch {
    throw new ApiError('INVALID_INPUT', 'imageBase64 must be valid Base64 (optionally data URI)', 400);
  }

  if (!contentType || !contentType.startsWith('image/')) {
    throw new ApiError('INVALID_INPUT', 'contentType must start with image/', 400);
  }

  if (bytes.length > MAX_IMAGE_SIZE_BYTES) {
    throw new ApiError('INVALID_INPUT', 'Image too large. Max size is 5MB', 400);
  }

  // Build multipart form without writing to disk
  const form = new FormData();
  const blob = new Blob([bytes], { type: contentType });
  form.append('file', blob, fileName);

  let resp;
  try {
    resp = await fetch(PIN_FILE_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${pinataJwt}` },
      body: form,
    });
  } catch (e) {
    throw new ApiError('UPSTREAM_ERROR', `Failed to reach Pinata: ${e.message}`, 502);
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new ApiError('UPSTREAM_ERROR', `Pinata error ${resp.status}: ${text || 'Unknown'}`, 502);
  }

  /** @type {{ IpfsHash?: string, PinSize?: number }} */
  const out = await resp.json().catch(() => ({}));
  if (!out.IpfsHash) {
    throw new ApiError('UPSTREAM_ERROR', 'Pinata did not return IpfsHash', 502);
  }

  const cid = out.IpfsHash;
  const ipfsUri = `ipfs://${cid}`;
  const gatewayUrl = `https://gateway.pinata.cloud/ipfs/${cid}`;

  return res.status(200).json({ ok: true, data: { cid, ipfsUri, gatewayUrl, fileName, contentType } });
}
