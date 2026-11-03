// Invariants of the economy: for every player the ledger adds up to the balance, and open bids
// match the credits they hold. pnpm check:ledger (exit code 1 and the list when it does not hold)
import 'dotenv/config';
process.env.DATABASE_URL = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
const { checkLedger } = await import('../server/services/ledgerCheck.js');
const { closeDb } = await import('../server/db/client.js');

const result = await checkLedger();
await closeDb();
if (!result.ok) {
  console.error(`${result.mismatches.length} mismatch(es) out of ${result.players} players:`);
  for (const m of result.mismatches) console.error(`  ${m.text} (${m.userId})`);
  process.exit(1);
}
console.log(`Ledger OK: ${result.players.toLocaleString('en-US')} players, ${result.entries.toLocaleString('en-US')} entries.`);
