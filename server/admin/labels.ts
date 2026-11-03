import type { UserRow } from '../http.js';

type Named = Pick<UserRow, 'id' | 'username' | 'isGuest' | 'deletedAt'>;

/** How staff screens name a player: "vex", "Guest #91c0", "Deleted player". */
export function playerLabel(u: Named): string {
  if (u.deletedAt) return 'Deleted player';
  if (u.username) return u.username;
  return `Guest #${u.id.slice(0, 4)}`;
}

/** Same, from raw SQL columns. */
export const labelOf = (id: string, username: string | null, deletedAt: Date | string | null) =>
  deletedAt ? 'Deleted player' : (username ?? `Guest #${id.slice(0, 4)}`);
