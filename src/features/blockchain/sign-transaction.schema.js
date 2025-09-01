import { z } from 'zod';

export const schema = z.object({
  unsignedTx: z.string().min(1), // Base64 serialized, unsigned
  privateKey: z.string().min(1), // Base58 encoded private key (ed25519 secret key)
});
