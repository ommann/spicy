import { z } from 'zod';

export const showcaseViewSchema = z.object({
  name: z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/, 'Use 1–64 lowercase letters, digits, hyphens, or underscores.'),
  path: z.string().max(2048).regex(/^\/(?:b\/[a-z0-9]{8}|t\/[a-z0-9]{8}(?:\/[a-z0-9]{8})?)\/?(?:[?#][^\r\n]*)?$/),
  width: z.number().int().positive().max(16384),
  height: z.number().int().positive().max(16384),
  dpr: z.number().positive().max(8),
  top: z.number().finite(),
  left: z.number().finite(),
  pointer: z.object({ x: z.number().nonnegative().finite(), y: z.number().nonnegative().finite() }).nullable(),
});

export type ShowcaseView = z.infer<typeof showcaseViewSchema>;
