import { and, asc, eq, inArray, ne } from 'drizzle-orm';
import { z } from 'zod';
import type { Item, TradeUpOptions, TradeUpOutcome, TradeUpQuote, TradeUpResult } from '../../shared/api.js';
import { db, type DbOrTx } from '../db/client.js';
import { activity, items, ledger, showcase, tradeUpInputs, tradeUps, users } from '../db/schema.js';
import type { DrawableSkin } from '../game/draw.js';
import { FEED_TIERS, PATTERN_COUNT, TIERS, TRADEUP_NEXT, econ, type Tier } from '../game/economy.js';
import { cryptoRng, type Rng } from '../game/rng.js';
import { averageFloat, drawTradeUp, tradeUpChances, type TradeUpInput, type TradeUpPools } from '../game/tradeup.js';
import { wearOf } from '../game/wear.js';
import { fail, type UserRow } from '../http.js';
import { catalog, skinCard } from './catalog.js';
import { findItems } from './items.js';

type ItemRow = typeof items.$inferSelect;

export const TRADEUP_TIERS = TIERS.filter((t) => TRADEUP_NEXT[t] !== undefined);

export const tradeUpOptionsSchema = z.object({
  tier: z.enum(TRADEUP_TIERS as [Tier, ...Tier[]]).default('milspec'),
  stattrak: z.enum(['0', '1']).default('0'),
});
export const tradeUpItemsSchema = z.object({ itemIds: z.array(z.uuid()).refine((a) => a.length <= econ().tradeupSize) });

/**
 * For each collection (= the content of its case), its normal skins by rarity, and the case
 * a contract result is credited to (for the album and the Case filter).
 */
async function contracts() {
  const cat = await catalog();
  const byCollection = new Map<string, { crateId: string; name: string; tiers: Map<Tier, Map<string, DrawableSkin>> }>();
  for (const id of cat.activeIds) {
    const crate = cat.crates.get(id)!;
    if (!crate.collection) continue;
    let entry = byCollection.get(crate.collection.id);
    if (!entry) {
      entry = { crateId: id, name: crate.collection.name, tiers: new Map() };
      byCollection.set(crate.collection.id, entry);
    }
    for (const tier of TIERS) {
      if (tier === 'gold') continue;
      const skins = entry.tiers.get(tier) ?? new Map<string, DrawableSkin>();
      for (const skin of crate.contents[tier]) skins.set(skin.id, skin);
      entry.tiers.set(tier, skins);
    }
  }
  const pools = (next: Tier): TradeUpPools => new Map([...byCollection].map(([id, c]) => [id, [...(c.tiers.get(next)?.values() ?? [])]]));
  return { cat, byCollection, pools };
}

const collectionOf = (cat: Awaited<ReturnType<typeof catalog>>, skinId: string) => cat.skins.get(skinId)?.collectionId ?? null;

/** Your items of one rarity, StatTrak or not (locked ones included, shown greyed). */
export async function tradeUpOptions(me: UserRow, tier: Tier, stattrak: boolean): Promise<TradeUpOptions> {
  const list = await findItems(db(), and(eq(items.ownerId, me.id), eq(items.tier, tier), eq(items.stattrak, stattrak), ne(items.status, 'destroyed')));
  list.sort((a, b) => Number(b.status === 'available') - Number(a.status === 'available') || (a.float ?? 0) - (b.float ?? 0));
  return { tier, stattrak, next: TRADEUP_NEXT[tier]!, items: list, size: econ().tradeupSize, tiers: TRADEUP_TIERS };
}

/**
 * Checks a set of items for a contract: yours, available, one allowed rarity, all StatTrak or none,
 * from a collection that has a next rarity. Returns the inputs of the draw.
 */
function validate(rows: ItemRow[], ids: string[], me: string, cat: Awaited<ReturnType<typeof catalog>>, pools: (next: Tier) => TradeUpPools) {
  if (rows.length !== ids.length || rows.some((r) => r.ownerId !== me || r.status !== 'available')) {
    fail(409, 'items_unavailable', 'Some of these items are no longer available (listed, in a trade or gone).');
  }
  if (!rows.length) return null;
  const tier = rows[0]!.tier;
  const next = TRADEUP_NEXT[tier];
  if (!next) return fail(400, 'bad_request', 'Covert, knives and gloves can’t go in a contract for now.');
  if (rows.some((r) => r.tier !== tier)) fail(400, 'bad_request', 'All the skins of a contract must have the same rarity.');
  const stattrak = rows[0]!.stattrak;
  if (rows.some((r) => r.stattrak !== stattrak)) fail(400, 'bad_request', 'A contract is all StatTrak™ or none.');
  const nextPools = pools(next);
  const inputs: TradeUpInput[] = rows.map((r) => {
    const collectionId = collectionOf(cat, r.skinId);
    if (!collectionId || !nextPools.get(collectionId)?.length) fail(400, 'bad_request', 'One of these skins has no collection to trade up into.');
    return { collectionId: collectionId!, float: r.float ?? 0 };
  });
  return { tier, next, stattrak, inputs, pools: nextPools };
}

/** Skins the player owns (not destroyed), for "Album +1". */
async function ownedSkins(tx: DbOrTx, userId: string, skinIds: string[]) {
  if (!skinIds.length) return new Set<string>();
  const rows = await tx
    .selectDistinct({ skinId: items.skinId })
    .from(items)
    .where(and(eq(items.ownerId, userId), ne(items.status, 'destroyed'), inArray(items.skinId, skinIds)));
  return new Set(rows.map((r) => r.skinId));
}

/** Preview of the contract with the items picked so far: average float and every possible result. */
export async function quoteTradeUp(me: UserRow, itemIds: string[]): Promise<TradeUpQuote> {
  const ids = [...new Set(itemIds)];
  const { cat, byCollection, pools } = await contracts();
  const rows = ids.length ? await db().select().from(items).where(inArray(items.id, ids)) : [];
  const checked = validate(rows, ids, me.id, cat, pools);
  if (!checked) return { count: 0, size: econ().tradeupSize, next: null, stattrak: null, avgFloat: null, outcomes: [] };
  const chances = tradeUpChances(checked.inputs, checked.pools);
  const owned = await ownedSkins(db(), me.id, chances.map((c) => c.skin.id));
  const outcomes: TradeUpOutcome[] = chances.map((c) => {
    const wear = wearOf(c.float)!;
    return {
      skin: skinCard(cat.skins.get(c.skin.id)!, checked.next),
      pct: Math.round(c.probability * 10_000) / 100,
      float: c.float,
      wear: { code: wear.code, name: wear.name },
      albumGain: !owned.has(c.skin.id),
      collection: { id: c.collectionId, name: byCollection.get(c.collectionId)!.name },
    };
  });
  return { count: rows.length, size: econ().tradeupSize, next: checked.next, stattrak: checked.stattrak, avgFloat: averageFloat(checked.inputs), outcomes };
}

async function resultOf(tx: DbOrTx, tradeUpId: string, resultItemId: string, albumGain: boolean): Promise<TradeUpResult> {
  const [item] = await findItems(tx, eq(items.id, resultItemId));
  return { id: tradeUpId, item: item as Item, albumGain };
}

/**
 * Signs a contract in one transaction: player then the 10 items locked (users → items, as
 * everywhere), the result drawn on the server, the 10 items destroyed and the new one created.
 * Replaying the same Idempotency-Key returns the same result.
 */
export async function signTradeUp(me: UserRow, itemIds: string[], requestId: string, rng: Rng = cryptoRng): Promise<TradeUpResult> {
  const ids = [...new Set(itemIds)];
  const { cat, byCollection, pools } = await contracts();
  return db().transaction(async (tx) => {
    const [user] = await tx.select().from(users).where(eq(users.id, me.id)).for('update');
    if (!user) return fail(401, 'unauthorized', 'Sign in or start a guest session first.');
    const [done] = await tx.select().from(tradeUps).where(and(eq(tradeUps.userId, user.id), eq(tradeUps.requestId, requestId)));
    if (done) return resultOf(tx, done.id, done.resultItemId, false);

    if (ids.length !== econ().tradeupSize) fail(400, 'bad_request', `A contract takes exactly ${econ().tradeupSize} skins.`);
    const rows = await tx.select().from(items).where(inArray(items.id, ids)).orderBy(asc(items.id)).for('update');
    const checked = validate(rows, ids, user.id, cat, pools)!;
    const drawn = drawTradeUp(checked.inputs, checked.pools, rng);
    const albumGain = !(await ownedSkins(tx, user.id, [drawn.skin.id])).has(drawn.skin.id);

    const now = new Date();
    await tx.update(items).set({ status: 'destroyed', destroyedAt: now }).where(inArray(items.id, ids));
    // Destroyed items leave the showcase.
    await tx.delete(showcase).where(inArray(showcase.itemId, ids));
    const [created] = await tx
      .insert(items)
      .values({
        skinId: drawn.skin.id,
        ownerId: user.id,
        originalOwnerId: user.id,
        float: drawn.float,
        pattern: rng.int(PATTERN_COUNT),
        stattrak: checked.stattrak,
        tier: checked.next,
        source: 'tradeup',
        sourceCrateId: byCollection.get(drawn.collectionId)!.crateId,
        acquiredVia: 'tradeup',
        obtainedAt: now,
      })
      .returning({ id: items.id });
    const [contract] = await tx
      .insert(tradeUps)
      .values({ userId: user.id, tier: checked.tier, stattrak: checked.stattrak, avgFloat: averageFloat(checked.inputs), resultItemId: created!.id, requestId })
      .returning({ id: tradeUps.id });
    await tx.insert(tradeUpInputs).values(ids.map((itemId) => ({ tradeUpId: contract!.id, itemId })));
    // No money moves: the journal still records the 10 items out and the one in.
    const ref = { userId: user.id, amount: 0, balanceAfter: user.balance, refId: contract!.id };
    await tx.insert(ledger).values([
      ...rows.map((r) => ({ ...ref, type: 'tradeup_in' as const, itemId: r.id, crateId: r.sourceCrateId })),
      { ...ref, type: 'tradeup_out' as const, itemId: created!.id, crateId: byCollection.get(drawn.collectionId)!.crateId },
    ]);
    if (FEED_TIERS.includes(checked.next)) await tx.insert(activity).values({ userId: user.id, type: 'tradeup', itemId: created!.id, createdAt: now });
    return resultOf(tx, contract!.id, created!.id, albumGain);
  });
}
