import { attachDatabasePool } from '@vercel/functions';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { env } from '../env.js';
import * as schema from './schema.js';

// int8 (COUNT, SUM, bigint columns in raw SQL) as JS numbers: balances stay far below 2^53.
pg.types.setTypeParser(20, (value) => Number.parseInt(value, 10));

let pool: pg.Pool | undefined;
let database: ReturnType<typeof createDb> | undefined;

function createDb(p: pg.Pool) {
  return drizzle(p, { schema, casing: 'snake_case' });
}

export type Db = ReturnType<typeof createDb>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type DbOrTx = Db | Tx;

// One small pool per process. On Vercel, DATABASE_URL is Neon's pooled (PgBouncer) URL, so
// interactive transactions with SELECT … FOR UPDATE are fine; no session-level state. Self-hosted,
// one long-lived process talks to Postgres directly and can keep more connections (DB_POOL_MAX).
export function db(): Db {
  if (!database) {
    pool = new pg.Pool({ connectionString: env().DATABASE_URL, max: env().DB_POOL_MAX, idleTimeoutMillis: 5_000 });
    attachDatabasePool(pool);
    database = createDb(pool);
  }
  return database;
}

export async function closeDb() {
  await pool?.end();
  pool = undefined;
  database = undefined;
}
