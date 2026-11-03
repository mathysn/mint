// Applies db/migrations to DATABASE_URL_UNPOOLED (direct connection, not the pooler).
// Runs in `vercel-build`, so every deployment (and every Neon preview branch) is migrated.
import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL_UNPOOLED (or DATABASE_URL) is required');

const client = new pg.Client({ connectionString: url });
await client.connect();
await migrate(drizzle(client), { migrationsFolder: 'db/migrations' });
await client.end();
console.log('Migrations applied.');
