import { z } from 'zod';

export const schema = z.object({
  sellerPublicKey: z.string().min(1),
  mintAddress: z.string().min(1),
  // String to safely handle large token amounts or percentages (e.g., "100%")
  tokenAmount: z.string().min(1),
  slippageBps: z.number().int().nonnegative(),
  priorityFeeSol: z.number().positive().optional(),
});
