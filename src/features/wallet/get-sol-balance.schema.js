import { z } from 'zod';

export const schema = z.object({
  publicKey: z.string().min(1),
});
