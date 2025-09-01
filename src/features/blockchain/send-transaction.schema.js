import { z } from 'zod';

export const schema = z.object({
  signedTx: z.string().min(1), // Base64 encoded, signed and serialized
});
