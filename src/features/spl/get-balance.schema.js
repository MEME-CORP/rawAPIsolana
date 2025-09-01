import { z } from 'zod';

export const schema = z.object({
  mintAddress: z.string().min(1),
  walletPublicKey: z.string().min(1),
});
