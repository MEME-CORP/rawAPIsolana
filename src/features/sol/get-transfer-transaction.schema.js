import { z } from 'zod';

export const schema = z.object({
  fromPublicKey: z.string().min(1),
  toPublicKey: z.string().min(1),
  amountSol: z.number().positive(),
  computeUnits: z.number().int().positive().optional(),
  microLamports: z.number().int().nonnegative().optional(),
  rentTopUp: z.boolean().optional(),
});
