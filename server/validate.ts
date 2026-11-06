import type { z } from 'zod';
import { fail } from './http.js';

/** Last part of the path, readable: "giveItemIds.3" → "giveItemIds". */
const fieldName = (path: PropertyKey[]) => String([...path].reverse().find((p) => typeof p === 'string') ?? 'request');

/**
 * Validates a request body. The message is shown as-is to the player (CLAUDE.md §5): a schema's own
 * sentence ("A reason is required.") is sent alone; Zod's default text gets the field name instead.
 */
export function parseJson<S extends z.ZodType>(schema: S, value: unknown): z.infer<S> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    if (!issue) return fail(400, 'bad_request', 'This request isn’t valid. Reload the page and try again.');
    const own = /^[A-Z].*[.!?]$/.test(issue.message);
    return fail(400, 'bad_request', own ? issue.message : `The field “${fieldName(issue.path)}” isn’t valid. Reload the page and try again.`);
  }
  return parsed.data;
}
