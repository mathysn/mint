import { eq } from 'drizzle-orm';
import type { Tx } from '../db/client.js';
import { ledger, users } from '../db/schema.js';
import { fail, type UserRow } from '../http.js';

export type LedgerType = (typeof ledger.$inferInsert)['type'];

/**
 * Running balances of locked players, written back once at the end: every move is one ledger row
 * with its `balance_after`. The players must already be locked (`lockUsers`).
 */
export class Wallets {
  private readonly balances = new Map<string, number>();
  readonly entries: (typeof ledger.$inferInsert)[] = [];

  constructor(players: Map<string, UserRow>) {
    for (const [id, u] of players) this.balances.set(id, u.balance);
  }

  get(userId: string) {
    return this.balances.get(userId)!;
  }

  move(userId: string, type: LedgerType, amount: number, refs: { refId?: string | null; itemId?: string; crateId?: string } = {}) {
    const balance = this.get(userId) + amount;
    if (balance < 0) fail(402, 'insufficient_balance', 'Not enough credits.');
    this.balances.set(userId, balance);
    this.entries.push({ userId, type, amount, balanceAfter: balance, ...refs });
  }

  /** Writes the ledger rows and balances; returns the new ledger ids (admin log details). */
  async save(tx: Tx): Promise<number[]> {
    const rows = this.entries.length ? await tx.insert(ledger).values(this.entries).returning({ id: ledger.id }) : [];
    for (const [id, balance] of this.balances) await tx.update(users).set({ balance }).where(eq(users.id, id));
    return rows.map((r) => r.id);
  }
}
