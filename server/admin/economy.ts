// Admin › Economy: the settings in force, a server-side check of what staff typed (errors, diff,
// simulator, impacts) and the save: one transaction, one `economy.update` admin_log row per key.
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { AdminActionResult, AdminEconomy, EconomyDiffRow, EconomyGroup, EconomyPreview, EconomySim } from '../../shared/api.js';
import { db, type DbOrTx } from '../db/client.js';
import { adminLog, economySettings } from '../db/schema.js';
import type { Economy, Tier } from '../game/economy.js';
import {
  changeText,
  economyFrom,
  formatSetting,
  GROUP_TITLE,
  longLabel,
  oddsTotalBp,
  parseSetting,
  sameValue,
  SETTING_BY_KEY,
  SETTINGS,
  type SettingDef,
  type SettingValue,
} from '../game/economySettings.js';
import { simulate, type SimCrate } from '../game/simulator.js';
import { fail } from '../http.js';
import { catalog } from '../services/catalog.js';
import { bumpEconomyVersion, reloadEconomy } from '../services/economySettings.js';
import { utcDay } from '../format.js';
import { reasonSchema, writeAdminLog } from './log.js';
import type { StaffMember } from './staff.js';

const editsSchema = z.record(z.string().max(40), z.string().max(200)).refine((r) => Object.keys(r).length <= SETTINGS.length, 'Too many settings.');
export const previewSchema = z.object({ edits: editsSchema });
export const saveSchema = z.object({ edits: editsSchema, reason: reasonSchema });

const pct = (bp: number) => (bp / 100).toFixed(2);

async function simCrates(): Promise<SimCrate[]> {
  const cat = await catalog();
  return cat.activeIds.map((id) => {
    const crate: SimCrate = { milspec: [], restricted: [], classified: [], covert: [], gold: [] };
    for (const { skin, tier } of cat.crates.get(id)!.entries) crate[tier].push(skin);
    return crate;
  });
}

const round = (s: EconomySim): EconomySim => ({ ...s, average: Math.round(s.average), min: Math.round(s.min), max: Math.round(s.max) });

/** The economy saved in the database (not the per-instance cache): what a save compares against. */
async function savedEconomy(tx: DbOrTx = db()): Promise<Economy> {
  return economyFrom(await tx.select().from(economySettings));
}

export async function economyPage(): Promise<AdminEconomy> {
  const e = await savedEconomy();
  const logs = await db()
    .select({ id: adminLog.id, at: adminLog.createdAt, staff: adminLog.staffName, key: adminLog.targetId, change: adminLog.change, reason: adminLog.reason })
    .from(adminLog)
    .where(eq(adminLog.action, 'economy.update'))
    .orderBy(desc(adminLog.createdAt), desc(adminLog.id))
    .limit(200);
  const last = new Map<string, { at: Date; staff: string }>();
  for (const l of logs) if (l.key && !last.has(l.key)) last.set(l.key, { at: l.at, staff: l.staff });
  const changed = (def: SettingDef) => {
    const l = last.get(def.key);
    if (!l) return null;
    const prefix = def.group === 'rarity' ? `${def.key.startsWith('odds.') ? 'Odds' : 'Recycle'} changed` : 'Changed';
    return `${prefix} ${utcDay(l.at)} by ${l.staff}`;
  };
  const groups: EconomyGroup[] = (Object.keys(GROUP_TITLE) as EconomyGroup['id'][]).map((id) => ({
    id,
    title: GROUP_TITLE[id],
    settings: SETTINGS.filter((s) => s.group === id).map((s) => ({
      key: s.key,
      label: s.label,
      help: s.help,
      unit: s.unit,
      tier: (s.tier ?? null) as Tier | null,
      value: formatSetting(s, s.read(e)),
      changed: changed(s),
    })),
  }));
  return {
    groups,
    oddsTotal: pct(oddsTotalBp(e)),
    sim: round(simulate(await simCrates(), e)),
    history: logs.slice(0, 50).map((l) => ({ id: l.id, at: l.at.toISOString(), staff: l.staff, key: l.key ?? '', change: l.change, reason: l.reason })),
  };
}

interface Checked {
  errors: Record<string, string>;
  changes: { def: SettingDef; from: SettingValue; to: SettingValue }[];
  next: Economy;
  oddsOk: boolean;
}

function check(current: Economy, edits: Record<string, string>): Checked {
  const errors: Record<string, string> = {};
  const changes: Checked['changes'] = [];
  let next = current;
  for (const [key, input] of Object.entries(edits)) {
    const def = SETTING_BY_KEY.get(key);
    if (!def) {
      errors[key] = 'Unknown setting.';
      continue;
    }
    const parsed = parseSetting(def, input);
    if ('error' in parsed) {
      errors[key] = parsed.error;
      continue;
    }
    const from = def.read(current);
    if (sameValue(from, parsed.value)) continue;
    next = def.write(next, parsed.value);
    changes.push({ def, from, to: parsed.value });
  }
  const oddsOk = oddsTotalBp(next) === 10_000;
  return { errors, changes, next, oddsOk };
}

function impacts(changes: Checked['changes'], next: Economy): string[] {
  const keys = changes.map((c) => c.def.key);
  const out: string[] = [];
  if (keys.includes('cases.price')) out.push('The new case price applies to the next case bought. Free cases stay free.');
  if (keys.includes('market.fee')) out.push(`Live auctions keep the fee they started with. New listings pay ${formatSetting(SETTING_BY_KEY.get('market.fee')!, next.marketFeeBp / 100)}%.`);
  if (keys.some((k) => k.startsWith('recycle.'))) out.push('Recycle values apply right away, to items players already own.');
  if (keys.some((k) => k.startsWith('odds.'))) out.push('New odds apply to the next opening. The Overview compares them with real drops.');
  if (keys.some((k) => k.startsWith('free_case.'))) out.push('Free case stacks are recomputed right away: a full stack stays full, a partial one fills at the new pace.');
  if (!out.length) out.push('Applies right away, no deploy needed.');
  return out;
}

const diffRows = (changes: Checked['changes']): EconomyDiffRow[] =>
  changes.map(({ def, from, to }) => ({
    key: def.key,
    label: longLabel(def),
    from: `${formatSetting(def, from)} ${def.unit}`,
    to: `${formatSetting(def, to)} ${def.unit}`,
  }));

export async function previewEconomy(edits: Record<string, string>): Promise<EconomyPreview> {
  const current = await savedEconomy();
  const c = check(current, edits);
  const bad = Object.keys(c.errors).length > 0;
  const total = pct(oddsTotalBp(c.next));
  return {
    errors: c.errors,
    oddsTotal: total,
    oddsOk: c.oddsOk,
    diff: diffRows(c.changes),
    sim: bad || !c.oddsOk ? null : round(simulate(await simCrates(), c.next)),
    impacts: impacts(c.changes, c.next),
    valid: !bad && c.oddsOk && c.changes.length > 0,
    invalidText: !c.oddsOk ? `Odds add up to ${total}%. They must make 100.00% to save.` : bad ? 'Some values can’t be saved. Check the fields in red.' : null,
  };
}

export async function saveEconomy(staff: StaffMember, input: z.infer<typeof saveSchema>): Promise<AdminActionResult> {
  const count = await db().transaction(async (tx) => {
    // One save at a time: bumping the version row locks it until the commit.
    await bumpEconomyVersion(tx, staff.name);
    const current = await savedEconomy(tx);
    const c = check(current, input.edits);
    const firstError = Object.entries(c.errors)[0];
    if (firstError) {
      const def = SETTING_BY_KEY.get(firstError[0]);
      fail(400, 'bad_request', `${def ? longLabel(def) : firstError[0]}: ${firstError[1]}`);
    }
    if (!c.oddsOk) fail(400, 'bad_request', `Odds add up to ${pct(oddsTotalBp(c.next))}%. They must make 100.00% to save.`);
    if (!c.changes.length) fail(400, 'bad_request', 'Nothing to save: every value is already in force.');
    const now = new Date();
    for (const { def, from, to } of c.changes) {
      await tx
        .insert(economySettings)
        .values({ key: def.key, value: to, updatedAt: now, updatedBy: staff.name })
        .onConflictDoUpdate({ target: economySettings.key, set: { value: to, updatedAt: now, updatedBy: staff.name } });
      await writeAdminLog(tx, staff, {
        action: 'economy.update',
        target: { type: 'economy', id: def.key, label: longLabel(def) },
        change: changeText(def, from, to),
        before: { [longLabel(def)]: `${formatSetting(def, from)} ${def.unit}` },
        after: { [longLabel(def)]: `${formatSetting(def, to)} ${def.unit}` },
        reason: input.reason,
      });
    }
    return c.changes.length;
  });
  await reloadEconomy();
  return { toast: `Saved ${count} economy ${count === 1 ? 'change' : 'changes'} · logged` };
}

