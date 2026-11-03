import { z } from 'zod';

// Discord variables are optional so the game still runs in guest mode on previews
// that have no OAuth redirect registered.
const schema = z.object({
  DATABASE_URL: z.string().min(1),
  DATABASE_URL_UNPOOLED: z.string().min(1).optional(),
  DISCORD_CLIENT_ID: z.string().optional(),
  DISCORD_CLIENT_SECRET: z.string().optional(),
  APP_BASE_URL: z.url().optional(),
  CRON_SECRET: z.string().optional(),
  IP_HASH_SALT: z.string().default('dev-salt'),
  /** Postgres connections per process: 5 on Vercel (many small instances), more when self-hosted. */
  DB_POOL_MAX: z.coerce.number().int().min(1).max(50).default(5),
  // Set by Vercel on every deployment (host names, without https://).
  VERCEL_ENV: z.string().optional(),
  VERCEL_URL: z.string().optional(),
  VERCEL_BRANCH_URL: z.string().optional(),
  VERCEL_PROJECT_PRODUCTION_URL: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function env(): Env {
  if (!cached) {
    // `KEY=` in .env means "not set".
    const defined = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== ''));
    const parsed = schema.safeParse(defined);
    if (!parsed.success) {
      const fields = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
      throw new Error(`Invalid environment variables: ${fields}`);
    }
    cached = parsed.data;
  }
  return cached;
}

export const discordEnabled = () => Boolean(env().DISCORD_CLIENT_ID && env().DISCORD_CLIENT_SECRET);
