import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  bigserial,
  boolean,
  check,
  customType,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const tierEnum = pgEnum('tier', ['milspec', 'restricted', 'classified', 'covert', 'gold']);
export const itemStatusEnum = pgEnum('item_status', ['available', 'listed', 'in_trade', 'destroyed']);
export const itemSourceEnum = pgEnum('item_source', ['case', 'tradeup', 'admin']);
export const sessionKindEnum = pgEnum('session_kind', ['web', 'activity']);
/** Why a session ended early: the player signed out, staff signed them out, a ban, a deleted account. */
export const sessionRevokeEnum = pgEnum('session_revoke', ['sign_out', 'admin', 'ban', 'deleted']);
export const authFlowStatusEnum = pgEnum('auth_flow_status', ['pending', 'success', 'conflict', 'error', 'consumed']);
export const ledgerTypeEnum = pgEnum('ledger_type', [
  'starting_balance',
  'case_open',
  'free_case_open',
  'daily_reward',
  'recycle',
  'trade_hold',
  'trade_release',
  'trade_credit_in',
  'trade_credit_out',
  'trade_item_in',
  'trade_item_out',
  'bid_hold',
  'bid_release',
  'auction_buy',
  'auction_sale',
  'auction_fee',
  'auction_item_in',
  'auction_item_out',
  'tradeup_in',
  'tradeup_out',
  // Staff actions (admin panel).
  'admin_grant',
  'admin_remove',
  'admin_item_grant',
  'admin_item_in',
  'admin_item_out',
  'admin_item_restore',
  'admin_clawback',
  'account_delete',
  'admin_gift',
]);
export const acquiredViaEnum = pgEnum('acquired_via', ['case', 'trade', 'market', 'tradeup', 'admin']);

// ── Accounts ────────────────────────────────────────────────────────────────

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    discordId: text('discord_id').unique(),
    username: text('username').unique(),
    displayName: text('display_name'),
    avatarHash: text('avatar_hash'),
    isGuest: boolean('is_guest').notNull(),
    balance: bigint('balance', { mode: 'number' }).notNull(),
    lastFreeCaseAt: timestamp('last_free_case_at', { withTimezone: true }),
    /** Extra free cases given by staff events, used before the timer. */
    bonusFreeCases: integer('bonus_free_cases').notNull().default(0),
    createdIpHash: text('created_ip_hash'),
    createdAt: createdAt(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    /** Set while banned. `ban_until` null with `banned_at` set = permanent. */
    bannedAt: timestamp('banned_at', { withTimezone: true }),
    banUntil: timestamp('ban_until', { withTimezone: true }),
    banReason: text('ban_reason'),
    bannedBy: text('banned_by'),
    /** Account deleted by staff: anonymised, history kept as "Deleted player". */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    /** Name reset by staff: the player picks a new one on their next visit. */
    nameResetAt: timestamp('name_reset_at', { withTimezone: true }),
  },
  (t) => [
    check('users_balance_non_negative', sql`${t.balance} >= 0`),
    check('users_guest_or_discord', sql`${t.isGuest} OR ${t.discordId} IS NOT NULL OR ${t.deletedAt} IS NOT NULL`),
    index('users_guest_ip_idx').on(t.createdIpHash, t.createdAt),
  ],
);

/** One row per player per UTC day they were seen (Overview: active players). */
export const playerDays = pgTable(
  'player_days',
  {
    day: date('day').notNull(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.day, t.userId] })],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: bytea('token_hash').notNull().unique(),
    kind: sessionKindEnum('kind').notNull(),
    createdAt: createdAt(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedReason: sessionRevokeEnum('revoked_reason'),
    /** Short label from the user agent ("Chrome · Windows", "Discord activity"). */
    device: text('device'),
    /** Salted hash of the IP at sign-in (same-IP signal), never the IP itself. */
    ipHash: text('ip_hash'),
    city: text('city'),
    country: text('country'),
  },
  (t) => [index('sessions_user_idx').on(t.userId), index('sessions_ip_idx').on(t.ipHash)],
);

export const authFlows = pgTable('auth_flows', {
  id: uuid('id').primaryKey().defaultRandom(),
  state: text('state').notNull().unique(),
  pollSecretHash: bytea('poll_secret_hash').notNull(),
  guestUserId: uuid('guest_user_id').references(() => users.id, { onDelete: 'set null' }),
  status: authFlowStatusEnum('status').notNull().default('pending'),
  discordId: text('discord_id'),
  discordProfile: jsonb('discord_profile'),
  resultUserId: uuid('result_user_id').references(() => users.id, { onDelete: 'set null' }),
  error: text('error'),
  createdAt: createdAt(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});

// ── Catalog (imported from ByMykel/CSGO-API) ────────────────────────────────

export const collections = pgTable('collections', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  imageUrl: text('image_url'),
});

export const skins = pgTable(
  'skins',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    weaponName: text('weapon_name').notNull(),
    finishName: text('finish_name'),
    category: text('category').notNull(),
    apiRarityId: text('api_rarity_id').notNull(),
    minFloat: doublePrecision('min_float'),
    maxFloat: doublePrecision('max_float'),
    stattrakAvailable: boolean('stattrak_available').notNull(),
    phase: text('phase'),
    paintIndex: text('paint_index'),
    imageUrl: text('image_url').notNull(),
    collectionId: text('collection_id').references(() => collections.id),
    /** The image URL answered with an error at the last check (catalog import). */
    imageBroken: boolean('image_broken').notNull().default(false),
    imageCheckedAt: timestamp('image_checked_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Both bounds or neither: vanilla knives have no wear in CS2.
    check('skins_float_range', sql`(${t.minFloat} IS NULL) = (${t.maxFloat} IS NULL)`),
  ],
);

export const crates = pgTable('crates', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  imageUrl: text('image_url').notNull(),
  price: integer('price').notNull(),
  releasedOn: date('released_on'),
  isActive: boolean('is_active').notNull().default(true),
  /** NEW badge in the shop, set by staff. */
  isNew: boolean('is_new').notNull().default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const crateItems = pgTable(
  'crate_items',
  {
    crateId: text('crate_id').notNull().references(() => crates.id, { onDelete: 'cascade' }),
    skinId: text('skin_id').notNull().references(() => skins.id),
    tier: tierEnum('tier').notNull(),
    special: boolean('special').notNull(),
  },
  (t) => [primaryKey({ columns: [t.crateId, t.skinId] }), index('crate_items_skin_idx').on(t.skinId)],
);

export const catalogImports = pgTable('catalog_imports', {
  id: uuid('id').primaryKey().defaultRandom(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  sourceCommit: text('source_commit').notNull(),
  counts: jsonb('counts'),
  status: text('status').notNull(),
  /** A dry run from the admin panel: nothing was written but this row and its report. */
  dryRun: boolean('dry_run').notNull().default(false),
  staffName: text('staff_name'),
  reason: text('reason'),
  report: jsonb('report'),
});

// ── Items and economy ───────────────────────────────────────────────────────

export const items = pgTable(
  'items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Short public number shown as "ID 000482113". */
    serial: bigint('serial', { mode: 'number' }).generatedAlwaysAsIdentity().notNull().unique(),
    skinId: text('skin_id').notNull().references(() => skins.id),
    ownerId: uuid('owner_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    float: doublePrecision('float'),
    pattern: smallint('pattern').notNull(),
    stattrak: boolean('stattrak').notNull(),
    tier: tierEnum('tier').notNull(),
    status: itemStatusEnum('status').notNull().default('available'),
    source: itemSourceEnum('source').notNull(),
    sourceCrateId: text('source_crate_id').references(() => crates.id),
    originalOwnerId: uuid('original_owner_id').references(() => users.id, { onDelete: 'set null' }),
    /** When the current owner got it (drop or trade). */
    obtainedAt: timestamp('obtained_at', { withTimezone: true }).notNull().defaultNow(),
    acquiredVia: acquiredViaEnum('acquired_via').notNull().default('case'),
    destroyedAt: timestamp('destroyed_at', { withTimezone: true }),
    /** Staff removed it from a showcase: it can't go back in one before this time. */
    showcaseBlockedUntil: timestamp('showcase_blocked_until', { withTimezone: true }),
  },
  (t) => [
    check('items_pattern_range', sql`${t.pattern} BETWEEN 0 AND 999`),
    check('items_float_range', sql`${t.float} IS NULL OR (${t.float} >= 0 AND ${t.float} <= 1)`),
    check('items_destroyed_at', sql`(${t.status} = 'destroyed') = (${t.destroyedAt} IS NOT NULL)`),
    index('items_owner_idx').on(t.ownerId, t.status, t.obtainedAt.desc()),
  ],
);

export const caseOpenings = pgTable(
  'case_openings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    crateId: text('crate_id').notNull().references(() => crates.id),
    itemId: uuid('item_id').notNull().unique().references(() => items.id, { onDelete: 'cascade' }),
    pricePaid: integer('price_paid').notNull(),
    free: boolean('free').notNull(),
    requestId: uuid('request_id').notNull(),
    strip: jsonb('strip').$type<string[]>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('case_openings_request_idx').on(t.userId, t.requestId)],
);

export const ledger = pgTable(
  'ledger',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    type: ledgerTypeEnum('type').notNull(),
    amount: bigint('amount', { mode: 'number' }).notNull(),
    balanceAfter: bigint('balance_after', { mode: 'number' }).notNull(),
    itemId: uuid('item_id').references(() => items.id, { onDelete: 'set null' }),
    crateId: text('crate_id').references(() => crates.id),
    refId: uuid('ref_id'),
    createdAt: createdAt(),
  },
  (t) => [index('ledger_user_idx').on(t.userId, t.createdAt)],
);

// ── Social (phase 4) ────────────────────────────────────────────────────────

export const friendshipStatusEnum = pgEnum('friendship_status', ['pending', 'accepted']);
export const activityTypeEnum = pgEnum('activity_type', ['unbox', 'sale', 'tradeup']);

/** One row per pair (user_low < user_high); requester_id says who asked. Declined = deleted. */
export const friendships = pgTable(
  'friendships',
  {
    userLow: uuid('user_low').notNull().references(() => users.id, { onDelete: 'cascade' }),
    userHigh: uuid('user_high').notNull().references(() => users.id, { onDelete: 'cascade' }),
    requesterId: uuid('requester_id').notNull(),
    status: friendshipStatusEnum('status').notNull().default('pending'),
    createdAt: createdAt(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.userLow, t.userHigh] }),
    check('friendships_ordered', sql`${t.userLow} < ${t.userHigh}`),
    check('friendships_requester', sql`${t.requesterId} IN (${t.userLow}, ${t.userHigh})`),
    index('friendships_high_idx').on(t.userHigh),
  ],
);

/** 5 items a player shows on their profile; position 1 is the main one. */
export const showcase = pgTable(
  'showcase',
  {
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    position: smallint('position').notNull(),
    itemId: uuid('item_id').notNull().unique().references(() => items.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.position] }), check('showcase_position', sql`${t.position} BETWEEN 1 AND 5`)],
);

/** Friends' feed: unboxings and sales from Classified (later: trade-ups). */
export const activity = pgTable(
  'activity',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    type: activityTypeEnum('type').notNull(),
    itemId: uuid('item_id').notNull().references(() => items.id, { onDelete: 'cascade' }),
    /** Sale price, for `sale`. */
    price: bigint('price', { mode: 'number' }),
    createdAt: createdAt(),
    /** Staff hid this ★ drop from the global banner. */
    hiddenAt: timestamp('hidden_at', { withTimezone: true }),
    hiddenBy: text('hidden_by'),
  },
  (t) => [index('activity_user_idx').on(t.userId, t.createdAt.desc())],
);

// ── Trades (phase 5) ────────────────────────────────────────────────────────

export const tradeStatusEnum = pgEnum('trade_status', ['pending', 'accepted', 'declined', 'cancelled', 'expired']);
export const tradeSideEnum = pgEnum('trade_side', ['sender', 'recipient']);
/** Why staff (not a player) closed an offer or a listing. */
export const staffCancelEnum = pgEnum('staff_cancel', ['ban', 'admin', 'deleted']);

/** An offer between two friends. The sender's items are `in_trade` and their credits held while pending. */
export const trades = pgTable(
  'trades',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Short number shown to staff ("offer #2231"). */
    number: bigint('number', { mode: 'number' }).generatedAlwaysAsIdentity().notNull().unique(),
    senderId: uuid('sender_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    recipientId: uuid('recipient_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    senderCredits: bigint('sender_credits', { mode: 'number' }).notNull().default(0),
    recipientCredits: bigint('recipient_credits', { mode: 'number' }).notNull().default(0),
    status: tradeStatusEnum('status').notNull().default('pending'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
    counterOf: uuid('counter_of').references((): AnyPgColumn => trades.id, { onDelete: 'set null' }),
    cancelReason: staffCancelEnum('cancel_reason'),
    /** Staff member who cancelled it (admin cancels). */
    cancelledBy: text('cancelled_by'),
  },
  (t) => [
    check('trades_credits', sql`${t.senderCredits} >= 0 AND ${t.recipientCredits} >= 0`),
    check('trades_two_players', sql`${t.senderId} <> ${t.recipientId}`),
    index('trades_sender_idx').on(t.senderId, t.status),
    index('trades_recipient_idx').on(t.recipientId, t.status),
    index('trades_expiry_idx').on(t.status, t.expiresAt),
  ],
);

export const tradeItems = pgTable(
  'trade_items',
  {
    tradeId: uuid('trade_id').notNull().references(() => trades.id, { onDelete: 'cascade' }),
    itemId: uuid('item_id').notNull().references(() => items.id, { onDelete: 'cascade' }),
    side: tradeSideEnum('side').notNull(),
  },
  (t) => [primaryKey({ columns: [t.tradeId, t.itemId] }), index('trade_items_item_idx').on(t.itemId)],
);

// ── Market (phase 6) ────────────────────────────────────────────────────────

export const auctionStatusEnum = pgEnum('auction_status', ['active', 'sold', 'unsold', 'cancelled']);
export const wearEnum = pgEnum('wear', ['FN', 'MW', 'FT', 'WW', 'BS']);

/**
 * A listing. The item is `listed` while active; the leader's bid (`current_bid`) is held from their
 * balance. Settled after `ends_at` (on read or by the cron): the outcome is fixed at `ends_at`.
 */
export const auctions = pgTable(
  'auctions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Short number shown to staff ("auction #8812"). */
    number: bigint('number', { mode: 'number' }).generatedAlwaysAsIdentity().notNull().unique(),
    itemId: uuid('item_id').notNull().references(() => items.id, { onDelete: 'cascade' }),
    sellerId: uuid('seller_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    startPrice: bigint('start_price', { mode: 'number' }).notNull(),
    buyNowPrice: bigint('buy_now_price', { mode: 'number' }),
    durationHours: smallint('duration_hours').notNull(),
    createdAt: createdAt(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    status: auctionStatusEnum('status').notNull().default('active'),
    leaderId: uuid('leader_id').references(() => users.id, { onDelete: 'set null' }),
    currentBid: bigint('current_bid', { mode: 'number' }),
    bidCount: integer('bid_count').notNull().default(0),
    buyerId: uuid('buyer_id').references(() => users.id, { onDelete: 'set null' }),
    finalPrice: bigint('final_price', { mode: 'number' }),
    fee: bigint('fee', { mode: 'number' }),
    boughtNow: boolean('bought_now').notNull().default(false),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    cancelReason: staffCancelEnum('cancel_reason'),
    cancelledBy: text('cancelled_by'),
    /** Sale fee at listing time, basis points: a live auction keeps it when the economy changes. */
    feeBp: integer('fee_bp').notNull().default(500),
  },
  (t) => [
    check('auctions_prices', sql`${t.startPrice} >= 1 AND (${t.buyNowPrice} IS NULL OR ${t.buyNowPrice} > ${t.startPrice})`),
    uniqueIndex('auctions_item_active_idx').on(t.itemId).where(sql`${t.status} = 'active'`),
    index('auctions_due_idx').on(t.status, t.endsAt),
    index('auctions_seller_idx').on(t.sellerId, t.status),
    index('auctions_leader_idx').on(t.leaderId, t.status),
  ],
);

export const bids = pgTable(
  'bids',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    auctionId: uuid('auction_id').notNull().references(() => auctions.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    amount: bigint('amount', { mode: 'number' }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('bids_auction_idx').on(t.auctionId, t.createdAt.desc()), index('bids_user_idx').on(t.userId, t.auctionId)],
);

/** Price history by skin, StatTrak and wear (null wear = vanilla). Kept when accounts go away. */
export const sales = pgTable(
  'sales',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    auctionId: uuid('auction_id').unique().references(() => auctions.id, { onDelete: 'set null' }),
    skinId: text('skin_id').notNull().references(() => skins.id),
    stattrak: boolean('stattrak').notNull(),
    wear: wearEnum('wear'),
    price: bigint('price', { mode: 'number' }).notNull(),
    soldAt: timestamp('sold_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('sales_skin_idx').on(t.skinId, t.stattrak, t.wear, t.soldAt.desc())],
);

/**
 * Market value of a skin in one wear, StatTrak or not: average of its last sales (economy.ts),
 * refreshed in the transaction of each sale. No row = never sold = recycle value.
 */
export const marketPrices = pgTable(
  'market_prices',
  {
    skinId: text('skin_id').notNull().references(() => skins.id),
    stattrak: boolean('stattrak').notNull(),
    wear: wearEnum('wear'),
    avgPrice: bigint('avg_price', { mode: 'number' }).notNull(),
    salesCount: integer('sales_count').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('market_prices_key').on(t.skinId, t.stattrak, t.wear).nullsNotDistinct()],
);

// ── Trade-up contracts (phase 7) ────────────────────────────────────────────

/** 10 items of one rarity in (destroyed), 1 item of the next rarity out. */
export const tradeUps = pgTable(
  'trade_ups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    tier: tierEnum('tier').notNull(),
    stattrak: boolean('stattrak').notNull(),
    avgFloat: doublePrecision('avg_float').notNull(),
    resultItemId: uuid('result_item_id').notNull().unique().references(() => items.id, { onDelete: 'cascade' }),
    requestId: uuid('request_id').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('trade_ups_request_idx').on(t.userId, t.requestId)],
);

export const tradeUpInputs = pgTable(
  'trade_up_inputs',
  {
    tradeUpId: uuid('trade_up_id').notNull().references(() => tradeUps.id, { onDelete: 'cascade' }),
    itemId: uuid('item_id').notNull().unique().references(() => items.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.tradeUpId, t.itemId] })],
);

// ── Admin panel ─────────────────────────────────────────────────────────────

export const staffRoleEnum = pgEnum('staff_role', ['viewer', 'moderator', 'admin']);

/** Staff are Discord accounts; the role decides which admin actions they may run (docs/ADMIN.md §2). */
export const staff = pgTable('staff', {
  discordId: text('discord_id').primaryKey(),
  role: staffRoleEnum('role').notNull(),
  addedBy: text('added_by'),
  createdAt: createdAt(),
});

/**
 * Every staff action, with who, why and what changed. Append-only: a trigger refuses UPDATE and
 * DELETE (migration 0009). No foreign keys, so entries outlive deleted players and staff.
 */
export const adminLog = pgTable(
  'admin_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    createdAt: createdAt(),
    staffDiscordId: text('staff_discord_id'),
    staffName: text('staff_name').notNull(),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id'),
    targetLabel: text('target_label').notNull(),
    change: text('change').notNull(),
    before: jsonb('before').$type<Record<string, unknown>>().notNull(),
    after: jsonb('after').$type<Record<string, unknown>>().notNull(),
    reason: text('reason').notNull(),
    details: jsonb('details').$type<Record<string, unknown>>(),
  },
  (t) => [
    index('admin_log_time_idx').on(t.createdAt.desc()),
    index('admin_log_target_idx').on(t.targetType, t.targetId, t.createdAt.desc()),
  ],
);

/** Staff-only notes on a player. */
export const staffNotes = pgTable(
  'staff_notes',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    staffName: text('staff_name').notNull(),
    text: text('text').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('staff_notes_user_idx').on(t.userId, t.createdAt.desc())],
);

/** Small key/value settings changed by staff: `case_of_day`, `catalog_version`. */
export const gameSettings = pgTable('game_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text('updated_by'),
});

export const jobNameEnum = pgEnum('job_name', ['purge_guests', 'expire_trades', 'settle_auctions', 'check_ledger']);

/** One row per scheduled job run (cron or "Run now"). */
export const jobRuns = pgTable(
  'job_runs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    job: jobNameEnum('job').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    ok: boolean('ok'),
    count: integer('count'),
    result: text('result'),
    durationMs: integer('duration_ms'),
    triggeredBy: text('triggered_by').notNull(),
  },
  (t) => [index('job_runs_job_idx').on(t.job, t.startedAt.desc())],
);

// Flags: raised by the monitors (server/admin/monitors.ts). Reports: filed by players.
export const flagStatusEnum = pgEnum('flag_status', ['open', 'handled']);

export const flags = pgTable(
  'flags',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    kind: text('kind').notNull(),
    status: flagStatusEnum('status').notNull().default('open'),
    tradeId: uuid('trade_id').references(() => trades.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    urgent: boolean('urgent').notNull().default(false),
    /** "trade monitor", "sign-up monitor", "market monitor". */
    monitor: text('monitor').notNull().default(''),
    /** [{ v: "6", k: "trades in 2 days" }, …] */
    evidence: jsonb('evidence').$type<{ v: string; k: string }[]>().notNull().default([]),
    text: text('text').notNull().default(''),
    /** One open flag per kind and players: a repeat refreshes it. */
    fingerprint: text('fingerprint'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    handledBy: text('handled_by'),
    handledAt: timestamp('handled_at', { withTimezone: true }),
    handledNote: text('handled_note'),
  },
  (t) => [index('flags_status_idx').on(t.status), uniqueIndex('flags_open_fingerprint_idx').on(t.fingerprint).where(sql`${t.status} = 'open'`)],
);

export const flagPlayers = pgTable(
  'flag_players',
  {
    flagId: bigint('flag_id', { mode: 'number' }).notNull().references(() => flags.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.flagId, t.userId] }), index('flag_players_user_idx').on(t.userId)],
);

export const reports = pgTable(
  'reports',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    reporterId: uuid('reporter_id').references(() => users.id, { onDelete: 'set null' }),
    targetId: uuid('target_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    category: text('category').notNull(),
    message: text('message'),
    status: flagStatusEnum('status').notNull().default('open'),
    createdAt: createdAt(),
    handledBy: text('handled_by'),
    handledAt: timestamp('handled_at', { withTimezone: true }),
    handledNote: text('handled_note'),
  },
  (t) => [
    index('reports_status_idx').on(t.status),
    index('reports_target_idx').on(t.targetId),
    // One open report per reporter and target.
    uniqueIndex('reports_open_pair_idx').on(t.reporterId, t.targetId).where(sql`${t.status} = 'open'`),
  ],
);

/** Economy settings saved by staff (admin › Economy); a missing key = the default of game/economy.ts. */
export const economySettings = pgTable('economy_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text('updated_by'),
});

/** The 40 px banner every player sees between `starts_at` and `ends_at` (or until ended early). */
export const announcements = pgTable(
  'announcements',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    text: text('text').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    createdBy: text('created_by').notNull(),
    createdAt: createdAt(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    endedBy: text('ended_by'),
  },
  (t) => [index('announcements_window_idx').on(t.startsAt, t.endsAt)],
);

/** API failures (4xx codes) counted per hour, for Logs › Errors. */
export const errorCounts = pgTable(
  'error_counts',
  {
    hour: timestamp('hour', { withTimezone: true }).notNull(),
    code: text('code').notNull(),
    count: integer('count').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.hour, t.code] })],
);

/** Server errors (5xx), grouped per hour by code, route and message. */
export const serverErrors = pgTable(
  'server_errors',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    hour: timestamp('hour', { withTimezone: true }).notNull(),
    code: text('code').notNull(),
    route: text('route').notNull(),
    message: text('message').notNull(),
    count: integer('count').notNull().default(1),
    lastAt: timestamp('last_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('server_errors_group').on(t.hour, t.code, t.route, t.message), index('server_errors_last_idx').on(t.lastAt.desc())],
);
