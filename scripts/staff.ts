// Staff of the admin panel (docs/ADMIN.md §2). Every change is written to the admin log.
//   pnpm staff:set <discordId> <viewer|moderator|admin>
//   pnpm staff:remove <discordId>
//   pnpm staff:list
import 'dotenv/config';

process.env.DATABASE_URL = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
const { eq } = await import('drizzle-orm');
const { db, closeDb } = await import('../server/db/client.js');
const { staff, users } = await import('../server/db/schema.js');
const { writeAdminLog } = await import('../server/admin/log.js');

const [command, discordId, role] = process.argv.slice(2);
const ROLES = ['viewer', 'moderator', 'admin'] as const;
const script = { discordId: null as unknown as string, name: 'script' };

async function nameOf(id: string) {
  const [user] = await db().select({ username: users.username }).from(users).where(eq(users.discordId, id));
  return user?.username ?? `Discord ${id}`;
}

if (command === 'list') {
  const rows = await db().select().from(staff);
  for (const r of rows) console.log(`${r.role.padEnd(10)} ${r.discordId}  ${await nameOf(r.discordId)}`);
  if (!rows.length) console.log('No staff yet. Add one: pnpm staff:set <discordId> admin');
} else if (command === 'set' && discordId && ROLES.includes(role as (typeof ROLES)[number])) {
  await db().transaction(async (tx) => {
    const [before] = await tx.select().from(staff).where(eq(staff.discordId, discordId)).for('update');
    const value = role as (typeof ROLES)[number];
    await tx.insert(staff).values({ discordId, role: value, addedBy: 'script' }).onConflictDoUpdate({ target: staff.discordId, set: { role: value } });
    await writeAdminLog(tx, script, {
      action: 'staff.set',
      target: { type: 'player', id: null, label: await nameOf(discordId) },
      change: `${before?.role ?? 'none'} → ${value}`,
      before: { role: before?.role ?? 'none' },
      after: { role: value, discord: discordId },
      reason: 'pnpm staff:set',
    });
  });
  console.log(`${await nameOf(discordId)} is now ${role}.`);
} else if (command === 'remove' && discordId) {
  await db().transaction(async (tx) => {
    const removed = await tx.delete(staff).where(eq(staff.discordId, discordId)).returning();
    if (!removed.length) throw new Error(`${discordId} is not staff.`);
    await writeAdminLog(tx, script, {
      action: 'staff.remove',
      target: { type: 'player', id: null, label: await nameOf(discordId) },
      change: `${removed[0]!.role} → none`,
      before: { role: removed[0]!.role },
      after: { role: 'none', discord: discordId },
      reason: 'pnpm staff:remove',
    });
  });
  console.log(`${await nameOf(discordId)} is no longer staff.`);
} else {
  console.error('Usage: pnpm staff:set <discordId> <viewer|moderator|admin> · pnpm staff:remove <discordId> · pnpm staff:list');
  process.exitCode = 1;
}
await closeDb();
