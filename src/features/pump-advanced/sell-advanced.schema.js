import { z } from 'zod';

export const schema = z.object({
  sellerPublicKey: z.string().min(1),
  mintAddress: z.string().min(1),
  tokenAmount: z.string().min(1), // string to support big ints or percentage like "50%"
  slippageBps: z.number().int().nonnegative(),
  priorityFeeSol: z.number().positive().optional(),
  privateKey: z.string().min(1), // Base58
  commitment: z.enum(['confirmed', 'finalized']).optional(),
});
