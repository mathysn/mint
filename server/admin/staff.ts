import { eq } from 'drizzle-orm';
import type { StaffRole } from '../../shared/api.js';
import { db, type DbOrTx } from '../db/client.js';
import { staff } from '../db/schema.js';
import { fail, type AppContext, type UserRow } from '../http.js';

export const ROLE_RANK: Record<StaffRole, number> = { viewer: 0, moderator: 1, admin: 2 };

/** The hint shown on a locked action (docs/ADMIN.md §2). */
export const ROLE_HINT: Record<Exclude<StaffRole, 'viewer'>, string> = {
  moderator: 'Moderators and admins',
  admin: 'Admins only',
};

export interface StaffMember {
  userId: string;
  discordId: string;
  name: string;
  role: StaffRole;
}

/** Staff = a Discord account (not a guest, not deleted) whose Discord ID is in `staff`. */
export async function staffRoleOf(user: Pick<UserRow, 'isGuest' | 'discordId' | 'deletedAt'>, tx: DbOrTx = db()): Promise<StaffRole | null> {
  if (user.isGuest || user.deletedAt || !user.discordId) return null;
  const [row] = await tx.select({ role: staff.role }).from(staff).where(eq(staff.discordId, user.discordId));
  return row?.role ?? null;
}

/**
 * Every admin route starts here: the server decides, the panel only mirrors it.
 * 403 "Staff only." for anyone else, and the role hint when the role is too low.
 */
export async function requireStaff(c: AppContext, min: StaffRole): Promise<StaffMember> {
  const user = c.get('user');
  const role = user ? await staffRoleOf(user) : null;
  if (!user || !role) return fail(403, 'forbidden', 'Staff only.');
  if (ROLE_RANK[role] < ROLE_RANK[min]) fail(403, 'forbidden', `${ROLE_HINT[min as Exclude<StaffRole, 'viewer'>]}.`);
  return { userId: user.id, discordId: user.discordId!, name: user.username ?? 'staff', role };
}
