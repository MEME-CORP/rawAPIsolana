import { z } from 'zod';

export const schema = z.object({
  creatorPublicKey: z.string().min(1),
  mintPublicKey: z.string().min(1),
  name: z.string().min(1),
  symbol: z.string().min(1),
  description: z.string().min(1),
  imageUrl: z.string().min(1),
  twitter: z.string().optional(),
  telegram: z.string().optional(),
  website: z.string().optional(),
  metadataUri: z.string().optional(),
  devBuyAmount: z.number().positive(),
  slippageBps: z.number().int().nonnegative(),
  priorityFeeSol: z.number().positive().optional(),
}, { required_error: 'Invalid input' });
