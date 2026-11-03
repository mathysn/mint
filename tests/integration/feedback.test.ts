import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { CaseFinder, Profile } from '../../shared/api.js';
import { closeDb, db } from '../../server/db/client.js';
import { crates } from '../../server/db/schema.js';
import { clearCatalogCache } from '../../server/services/catalog.js';
import { Client, giveItem, newAccount, resetDb } from './helpers.js';

beforeEach(resetDb);
afterAll(closeDb);

const find = (q: string, crate?: string) => new Client().json<CaseFinder>(`/crates/find?${new URLSearchParams(crate ? { q, crate } : { q })}`);

describe('weapon finder (GET /crates/find)', () => {
  it('needs 2 characters and returns nothing for an unknown skin', async () => {
    expect((await find('g')).body).toEqual({ crates: [], skins: [] });
    expect((await find('zzz')).body).toEqual({ crates: [], skins: [] });
  });

  it('lists every case that drops a ★ item, newest first, without an account', async () => {
    const res = await find('knife');
    expect(res.status).toBe(200);
    expect(res.body.skins.map((s) => s.skin.name)).toEqual(['★ Knife']);
    expect(res.body.skins[0]!.crateIds).toEqual(['crate-b', 'crate-a']);
    expect(res.body.crates.map((c) => c.id)).toEqual(['crate-b', 'crate-a']);
    expect(res.body.crates[0]).toMatchObject({ matchCount: 1, matches: [{ name: '★ Knife', tier: 'gold' }] });
  });

  it('every word must match; best matches first, rarest first', async () => {
    expect((await find('gun m1')).body.skins.map((s) => s.skin.name)).toEqual(['Gun | m1']);
    const all = (await find('gun')).body;
    expect(all.skins.map((s) => s.skin.id)).toEqual(['k1', 'c1', 'r1', 'm1', 'm2']);
    // 3 matches per case on the grid, all of them for one case.
    expect(all.crates[0]).toMatchObject({ matchCount: 5 });
    expect(all.crates[0]!.matches).toHaveLength(3);
    const one = (await find('gun', 'crate-a')).body;
    expect(one.crates.map((c) => c.id)).toEqual(['crate-a']);
    expect(one.crates[0]!.matches).toHaveLength(5);
    expect(one.skins.every((s) => s.crateIds.join() === 'crate-a')).toBe(true);
  });

  it('leaves inactive cases out', async () => {
    await db().update(crates).set({ isActive: false }).where(eq(crates.id, 'crate-a'));
    clearCatalogCache();
    const res = (await find('knife')).body;
    expect(res.crates.map((c) => c.id)).toEqual(['crate-b']);
    expect(res.skins[0]!.crateIds).toEqual(['crate-b']);
  });
});

describe('roulette strip', () => {
  it('never shows a ★ item, not even when it is the result', async () => {
    const { openCrate } = await import('../../server/services/openCrate.js');
    const vex = await newAccount('vex');
    // Always the last option: the ★ tier, then the last ★ skin.
    const last = { int: (n: number) => n - 1, unit: () => 0.5 };
    const requestId = crypto.randomUUID();
    const res = await openCrate({ userId: vex.user.id, crateId: 'crate-a', free: false, requestId }, last);
    expect(res.item.skin.tier).toBe('gold');
    expect(res.strip[res.resultIndex]).toEqual({ rareSpecial: true });
    expect(res.strip.every((card) => 'rareSpecial' in card || card.tier !== 'gold')).toBe(true);
    // A replay of the same opening hides it too.
    const again = await openCrate({ userId: vex.user.id, crateId: 'crate-a', free: false, requestId });
    expect(again.strip).toEqual(res.strip);
  });
});

describe('profile albums', () => {
  it('only shows started albums, with the case image', async () => {
    const vex = await newAccount('vex');
    const fresh = await newAccount('kenji');
    await giveItem(vex.user.id, 'milspec');
    const profile = (await fresh.client.json<Profile>('/players/vex')).body;
    expect(profile.albums.length).toBeGreaterThan(0);
    expect(profile.albums.every((a) => a.owned > 0)).toBe(true);
    expect(profile.albums[0]!.crate.imageUrl).toMatch(/^https:\/\/img\.test\//);
    expect((await vex.client.json<Profile>('/players/kenji')).body.albums).toEqual([]);
  });
});
