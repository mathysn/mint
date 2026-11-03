// Integration tests run against a real Postgres (pnpm db:local → database mint_test).
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://mint:mint@localhost:54329/mint_test';
process.env.DATABASE_URL_UNPOOLED = process.env.DATABASE_URL;
process.env.APP_BASE_URL = 'http://localhost:5173';
process.env.DISCORD_CLIENT_ID = 'test-client';
process.env.DISCORD_CLIENT_SECRET = 'test-secret';
process.env.CRON_SECRET = 'test-cron';
process.env.IP_HASH_SALT = 'test-salt';
