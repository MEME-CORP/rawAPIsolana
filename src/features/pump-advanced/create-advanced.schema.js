import { z } from 'zod';

export const schema = z
  .object({
    creatorPublicKey: z.string().min(1),
    mintPublicKey: z.string().min(1).optional(),
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
    privateKey: z.string().min(1), // Base58 (creator)
    mintPrivateKey: z.string().min(1).optional(), // Base58 (mint)
    commitment: z.enum(['confirmed', 'finalized']).optional(),
  })
  .refine(
    (d) =>
      (typeof d.mintPublicKey === 'string' && typeof d.mintPrivateKey === 'string') ||
      (typeof d.mintPublicKey === 'undefined' && typeof d.mintPrivateKey === 'undefined'),
    {
      message: 'mintPublicKey and mintPrivateKey must both be provided or both omitted',
      path: ['mintPublicKey'],
    }
  );
