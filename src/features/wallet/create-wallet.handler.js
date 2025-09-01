import bs58 from 'bs58';
import { Keypair } from '@solana/web3.js';
import { schema } from './create-wallet.schema.js';

/**
 * @typedef {import('express').Request} Request
 * @typedef {import('express').Response} Response
 */

/** @param {Request} req @param {Response} res */
export async function createWalletHandler(req, res) {
  const parsed = schema.parse(req.body ?? {});

  const wallets = Array.from({ length: parsed.count }).map(() => {
    const kp = Keypair.generate();
    return {
      publicKey: kp.publicKey.toBase58(),
      privateKey: bs58.encode(kp.secretKey),
    };
  });

  return res.status(200).json({ ok: true, data: wallets });
}
