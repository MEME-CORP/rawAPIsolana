import { z } from 'zod';

export const schema = z.object({
  fromPublicKey: z.string().min(1),
  toPublicKey: z.string().min(1),
  amountSol: z.number().positive(),
  // Base58-encoded private key for the sender. Used strictly for signing in this endpoint.
  privateKey: z.string().min(1),
  // Optional priority fee controls
  computeUnits: z.number().int().positive().optional(),
  microLamports: z.number().int().nonnegative().optional(),
  // Confirmation level
  commitment: z.enum(['confirmed', 'finalized']).optional(),
});
