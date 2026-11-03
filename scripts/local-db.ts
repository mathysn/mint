// Starts a real local Postgres (binaries from the embedded-postgres package, no install needed).
// Data lives in .local/pg and survives restarts. Stop with Ctrl+C.
import { existsSync } from 'node:fs';
import EmbeddedPostgres from 'embedded-postgres';

const PORT = 54329;
const DATA_DIR = '.local/pg';
const DATABASES = ['mint', 'mint_test'];

const pg = new EmbeddedPostgres({
  databaseDir: DATA_DIR,
  port: PORT,
  user: 'mint',
  password: 'mint',
  persistent: true,
  // Same as Neon: UTF-8 (the Windows default WIN1252 cannot store "★").
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
  onLog: () => {},
});

if (!existsSync(`${DATA_DIR}/PG_VERSION`)) {
  console.log('Initialising local Postgres cluster…');
  await pg.initialise();
}
await pg.start();

const admin = pg.getPgClient('postgres');
await admin.connect();
for (const name of DATABASES) {
  const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
  if (!rowCount) await pg.createDatabase(name);
}
await admin.end();

console.log(`Local Postgres ready on port ${PORT}`);
for (const name of DATABASES) console.log(`  postgres://mint:mint@localhost:${PORT}/${name}`);
console.log('Ctrl+C to stop.');

const stop = async () => {
  await pg.stop();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
