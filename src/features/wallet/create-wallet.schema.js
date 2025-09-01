import { z } from 'zod';

export const schema = z.object({
  count: z.number().int().positive().default(1),
});
