import type { z } from 'zod';
import { fail } from './http.js';

export function parseJson<S extends z.ZodType>(schema: S, value: unknown): z.infer<S> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return fail(400, 'bad_request', issue ? `${issue.path.join('.') || 'body'}: ${issue.message}` : 'Invalid request.');
  }
  return parsed.data;
}
