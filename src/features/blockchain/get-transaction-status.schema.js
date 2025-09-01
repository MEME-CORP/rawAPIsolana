import { z } from 'zod';

// Path params schema
export const schema = z.object({
  signature: z.string().min(1),
});
