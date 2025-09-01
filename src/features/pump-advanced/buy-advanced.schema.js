import { z } from 'zod';

export const schema = z.object({
  buyerPublicKey: z.string().min(1),
  mintAddress: z.string().min(1),
  solAmount: z.number().positive(),
  slippageBps: z.number().int().nonnegative(),
  priorityFeeSol: z.number().positive().optional(),
  privateKey: z.string().min(1), // Base58
  commitment: z.enum(['confirmed', 'finalized']).optional(),
});
