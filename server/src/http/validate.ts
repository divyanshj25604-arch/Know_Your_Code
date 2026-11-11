import type { z } from 'zod';
import { KycError } from '@kyc/core';

/** Validate untrusted input. Failures become INVALID_REQUEST with field paths, never parser internals. */
export function parse<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success)
    throw new KycError('INVALID_REQUEST', 'That request was not valid.', {
      issues: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    });
  return r.data;
}
