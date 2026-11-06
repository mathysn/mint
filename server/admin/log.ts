import { z } from 'zod';
import type { DbOrTx } from '../db/client.js';
import { adminLog } from '../db/schema.js';
import type { StaffMember } from './staff.js';

/** Required on every staff action; shown in the admin log (and to the player for a ban). */
export const reasonSchema = z.string().trim().min(1, 'A reason is required.').max(500);

export type LogTarget = {
  // 'guests' and 'trade' only on old rows (now 'player' and 'offer').
  type: 'player' | 'item' | 'case' | 'catalog' | 'guests' | 'job' | 'economy' | 'auction' | 'trade' | 'offer' | 'flag' | 'report' | 'drop' | 'announcement' | 'event';
  id: string | null;
  label: string;
};

export interface LogEntry {
  /** "player.add_credits", "player.ban"… (verb after the dot; old rows keep their old names). */
  action: string;
  target: LogTarget;
  /** Short change shown in the table ("−5,000 CR", "7 days", "active → off"). */
  change: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  reason: string;
  details?: Record<string, unknown>;
}

/** Last write of every staff transaction. The table is append-only (trigger in migration 0009). */
export async function writeAdminLog(tx: DbOrTx, staff: Pick<StaffMember, 'discordId' | 'name'>, entry: LogEntry) {
  const [row] = await tx
    .insert(adminLog)
    .values({
      staffDiscordId: staff.discordId,
      staffName: staff.name,
      action: entry.action,
      targetType: entry.target.type,
      targetId: entry.target.id,
      targetLabel: entry.target.label,
      change: entry.change,
      before: entry.before,
      after: entry.after,
      reason: entry.reason,
      details: entry.details ?? null,
    })
    .returning({ id: adminLog.id });
  return row!.id;
}
