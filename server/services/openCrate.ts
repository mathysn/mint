import { and, eq } from 'drizzle-orm';
import type { OpenResult, StripCard } from '../../shared/api.js';
import { db } from '../db/client.js';
import { activity, caseOpenings, items, ledger, users } from '../db/schema.js';
import { freeCaseState } from '../game/dailyCrate.js';
import { RARE_SPECIAL_CARD, STRIP_RESULT_INDEX, buildStrip, drawFromCrate } from '../game/draw.js';
import { econ, FEED_TIERS } from '../game/economy.js';
import { cryptoRng, type Rng } from '../game/rng.js';
import { fail } from '../http.js';
import { freeCaseFor } from './accounts.js';
import { caseOfDay, catalog, skinCard, type Catalog } from './catalog.js';
import { findItems } from './items.js';

export interface OpenRequest {
  userId: string;
  crateId: string;
  /** Use today's free case instead of paying. */
  free: boolean;
  /** Idempotency-Key: replaying the same key returns the same opening, never a second charge. */
  requestId: string;
}

/**
 * Opens a case in ONE transaction, with the player's row locked:
 * checks → draw (crypto RNG) → debit → item → opening record → ledger.
 * The result exists in the database before the client starts the roulette.
 */
export async function openCrate(req: OpenRequest, rng: Rng = cryptoRng): Promise<OpenResult> {
  const cat = await catalog();

  return db().transaction(async (tx) => {
    const [user] = await tx.select().from(users).where(eq(users.id, req.userId)).for('update');
    if (!user) return fail(401, 'unauthorized', 'Unknown player.');

    const [previous] = await tx
      .select()
      .from(caseOpenings)
      .where(and(eq(caseOpenings.userId, user.id), eq(caseOpenings.requestId, req.requestId)));
    if (previous) {
      const [item] = await findItems(tx, eq(items.id, previous.itemId));
      return {
        openingId: previous.id,
        free: previous.free,
        item: item!,
        strip: stripCards(cat, previous.strip),
        resultIndex: STRIP_RESULT_INDEX,
        balance: user.balance,
        freeCase: await freeCaseFor(user),
      };
    }

    const crate = cat.crates.get(req.crateId);
    if (!crate) return fail(404, 'crate_inactive', 'This case cannot be opened.');

    const now = new Date();
    let price = econ().casePrice;
    if (req.free) {
      // A bonus case (staff event) is used before the timer.
      const state = user.bonusFreeCases > 0 ? { available: true } : freeCaseState(user.lastFreeCaseAt, now);
      if (!state.available || caseOfDay(cat, now) !== crate.row.id) {
        return fail(409, 'free_case_unavailable', 'Your free case is not available for this case right now.');
      }
      price = 0;
    } else if (user.balance < price) {
      return fail(402, 'insufficient_balance', `You need ${price} CR to open this case.`);
    }

    const draw = drawFromCrate(crate.contents, rng);
    const strip = buildStrip(crate.contents, draw, rng);
    const balance = user.balance - price;

    await tx
      .update(users)
      .set(req.free ? (user.bonusFreeCases > 0 ? { balance, bonusFreeCases: user.bonusFreeCases - 1 } : { balance, lastFreeCaseAt: now }) : { balance })
      .where(eq(users.id, user.id));

    const [item] = await tx
      .insert(items)
      .values({
        skinId: draw.skinId,
        ownerId: user.id,
        float: draw.float,
        pattern: draw.pattern,
        stattrak: draw.stattrak,
        tier: draw.tier,
        source: 'case',
        sourceCrateId: crate.row.id,
        originalOwnerId: user.id,
        obtainedAt: now,
      })
      .returning({ id: items.id });

    const [opening] = await tx
      .insert(caseOpenings)
      .values({ userId: user.id, crateId: crate.row.id, itemId: item!.id, pricePaid: price, free: req.free, requestId: req.requestId, strip })
      .returning({ id: caseOpenings.id });

    await tx.insert(ledger).values({
      userId: user.id,
      type: req.free ? 'free_case_open' : 'case_open',
      amount: -price,
      balanceAfter: balance,
      itemId: item!.id,
      crateId: crate.row.id,
      refId: opening!.id,
    });

    if (FEED_TIERS.includes(draw.tier)) await tx.insert(activity).values({ userId: user.id, type: 'unbox', itemId: item!.id });

    const [created] = await findItems(tx, eq(items.id, item!.id));
    return {
      openingId: opening!.id,
      free: req.free,
      item: created!,
      strip: stripCards(cat, strip),
      resultIndex: STRIP_RESULT_INDEX,
      balance,
      freeCase: await freeCaseFor(
        req.free && user.bonusFreeCases > 0
          ? { lastFreeCaseAt: user.lastFreeCaseAt, bonusFreeCases: user.bonusFreeCases - 1 }
          : { lastFreeCaseAt: req.free ? now : user.lastFreeCaseAt, bonusFreeCases: user.bonusFreeCases },
        now,
      ),
    };
  });
}

/**
 * Cards sent to the roulette. A ★ item never shows in the strip, not even as the result:
 * it is the "★ Rare special" card like the teasers, and the knife or gloves appear at the reveal.
 * Applied here (not in the stored strip) so replays of older openings hide it too.
 */
function stripCards(cat: Catalog, strip: string[]): StripCard[] {
  return strip.map((id) => {
    const skin = id === RARE_SPECIAL_CARD ? undefined : cat.skins.get(id);
    const tier = cat.tiers.get(id);
    return skin && tier && tier !== 'gold' ? skinCard(skin, tier) : { rareSpecial: true };
  });
}
