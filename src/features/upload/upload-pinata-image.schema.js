import { z } from 'zod';

export const schema = z.object({
  // File name for Pinata (e.g., "logo.png")
  fileName: z.string().min(1),
  // MIME type, must be an image
  contentType: z
    .string()
    .min(1)
    .refine((v) => v.startsWith('image/'), {
      message: 'contentType must start with image/',
    }),
  // Base64-encoded image payload. Do NOT include a data URI prefix.
  // If you do include a data URI (data:image/png;base64,...) the handler will attempt to parse it.
  imageBase64: z.string().min(1),
});
