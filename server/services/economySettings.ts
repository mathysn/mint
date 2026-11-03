import { eq } from 'drizzle-orm';
import { db, type DbOrTx } from '../db/client.js';
import { economySettings, gameSettings } from '../db/schema.js';
import { DEFAULT_ECONOMY, setEconomy } from '../game/economy.js';
import { economyFrom } from '../game/economySettings.js';

// The economy in force, per function instance: reloaded as soon as `economy_version` changes
// (checked at most every 10 s), so a staff save reaches every instance within seconds.
const CHECK_MS = 10_000;
let checkedAt = 0;
let version: string | null | undefined;

async function readVersion(): Promise<string | null> {
  const [row] = await db().select({ value: gameSettings.value }).from(gameSettings).where(eq(gameSettings.key, 'economy_version'));
  return row ? String(row.value) : null;
}

export async function reloadEconomy() {
  version = await readVersion();
  setEconomy(economyFrom(await db().select().from(economySettings)));
  checkedAt = Date.now();
}

/** Called before every request (app middleware) and by scripts. */
export async function refreshEconomy() {
  if (version !== undefined && Date.now() - checkedAt < CHECK_MS) return;
  const current = await readVersion();
  if (current !== version || version === undefined) await reloadEconomy();
  else checkedAt = Date.now();
}

/** Tests: forget everything (the database was emptied). */
export function resetEconomyCache() {
  version = undefined;
  checkedAt = 0;
  setEconomy(DEFAULT_ECONOMY);
}

export async function bumpEconomyVersion(tx: DbOrTx, by: string) {
  const value = String(Date.now());
  await tx
    .insert(gameSettings)
    .values({ key: 'economy_version', value, updatedBy: by })
    .onConflictDoUpdate({ target: gameSettings.key, set: { value, updatedAt: new Date(), updatedBy: by } });
}
