// API contracts shared by the server and the React client. Types only: the client never
// recomputes anything that is here, it only displays what the server sends.

export type Tier = 'milspec' | 'restricted' | 'classified' | 'covert' | 'gold';
export type WearCode = 'FN' | 'MW' | 'FT' | 'WW' | 'BS';
export type ItemStatus = 'available' | 'listed' | 'in_trade' | 'destroyed';

export interface ApiError {
  error: { code: ErrorCode; message: string; ban?: BanInfo };
}

export type ErrorCode =
  | 'bad_request'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'rate_limited'
  | 'insufficient_balance'
  | 'free_case_unavailable'
  | 'crate_inactive'
  | 'discord_disabled'
  | 'items_unavailable'
  | 'confirmation_required'
  | 'account_required'
  | 'limit_reached'
  | 'conflict'
  | 'bid_too_low'
  | 'auction_ended'
  | 'banned'
  | 'balance_too_low'
  | 'not_stuck'
  | 'confirm_name_mismatch'
  | 'internal';

/** A banned player: the game is read-only for them. Sent with 403 `banned` and in `Me`. */
export interface BanInfo {
  /** ISO end of the ban; null = permanent. */
  until: string | null;
  reason: string;
  /** "You’re banned until Oct 30, 14:12." or "You’re banned from Mint." */
  message: string;
}

/** The free case stack: one case every few minutes, saved up to `max` (plus staff bonus cases). */
export interface FreeCase {
  /** At least one free case is ready. */
  available: boolean;
  /** Free cases ready now; bonus cases from staff events can take it above `max`. */
  count: number;
  /** Most free cases the stack saves up. */
  max: number;
  /** ISO date of the next free case from the timer; null when the stack is full. */
  nextAt: string | null;
  /** Today's free case. */
  crateId: string | null;
  /** ISO date when the case of the day moves to the next case; null while staff hold it in place. */
  crateChangesAt: string | null;
}

export type StaffRole = 'viewer' | 'moderator' | 'admin';

/** POST /me/delete ("Delete my account"): type your name to confirm. Answers 204 and clears the session. */
export interface DeleteOwnAccountBody {
  confirmName: string;
}

export interface Me {
  id: string;
  isGuest: boolean;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  balance: number;
  freeCase: FreeCase;
  /** Friend requests waiting for an answer (badge). */
  friendRequests: number;
  /** Trade offers received and waiting for an answer (badge). */
  tradeOffers: number;
  /** Your leading bids, already taken from the balance ("Held in bids"). */
  heldInBids: number;
  /** Set while banned: the game is read-only. */
  ban: BanInfo | null;
  /** Staff reset the name: the player picks a new one before playing. */
  mustPickName: boolean;
  /** Staff role, so the game can link to /admin. */
  staffRole: StaffRole | null;
}

export interface Wear {
  code: WearCode;
  name: string;
}

export interface SkinCard {
  id: string;
  name: string;
  weaponName: string;
  finishName: string | null;
  phase: string | null;
  imageUrl: string;
  tier: Tier;
}

export interface Item {
  id: string;
  skin: SkinCard;
  float: number | null;
  /** Skin float range, for the hatching of the float bar. */
  minFloat: number | null;
  maxFloat: number | null;
  wear: Wear | null;
  pattern: number;
  stattrak: boolean;
  status: ItemStatus;
  /** Displayed value: recent average sale price (last sales of this skin, StatTrak and wear), else the recycle value. */
  value: number;
  /** What recycling pays: fixed grid tier × StatTrak × wear. */
  recycleValue: number;
  /** Recycling it asks for a confirmation (Classified or better). */
  recycleConfirm: boolean;
  obtainedAt: string;
  crate: { id: string; name: string } | null;
}

export interface Completion {
  owned: number;
  total: number;
}

export interface CrateSummary {
  id: string;
  name: string;
  imageUrl: string;
  price: number;
  isNew: boolean;
  isFreeToday: boolean;
  /** Normal skins of the case already owned (the ★ items are not part of the count). */
  completion: Completion;
  /** Number of normal skins, e.g. 17 for "17 skins + ★ rare special". */
  skinCount: number;
}

export interface OddsRow {
  tier: Tier;
  /** Percent, e.g. 79.92 */
  pct: number;
}

export interface CrateGroupSkin extends SkinCard {
  owned: boolean;
}

/** ★ items are shown as one card per knife or glove type ("★ Kukri Knife · Any finish"). */
export interface CrateSpecialType {
  weaponName: string;
  category: string;
  imageUrl: string;
  finishCount: number;
}

export interface CrateDetail {
  crate: CrateSummary;
  groups: { tier: Exclude<Tier, 'gold'>; pct: number; skins: CrateGroupSkin[] }[];
  special: { pct: number; types: CrateSpecialType[] };
  freeCase: FreeCase;
}

export type StripCard = SkinCard | { rareSpecial: true };

export interface OpenResult {
  openingId: string;
  free: boolean;
  item: Item;
  /** 48 cards; the result is at index 40 (DESIGN.md §5). */
  strip: StripCard[];
  resultIndex: number;
  balance: number;
  freeCase: FreeCase;
}

export type InventorySort = 'value' | 'recent' | 'float';

export interface InventoryPage {
  items: Item[];
  /** Items matching the filters. */
  matched: number;
  hasMore: boolean;
  /** Whole inventory, filters ignored: "18 items · ≈ 28,790 CR". */
  totalCount: number;
  totalValue: number;
  /** Cases the player has items from, for the Case filter. */
  crates: { id: string; name: string }[];
}

export interface RecycleQuote {
  count: number;
  total: number;
  requiresConfirmation: boolean;
  /** Selected ids that cannot be recycled (not yours, listed, in a trade, already destroyed). */
  unavailable: string[];
}

export interface RecycleResult {
  count: number;
  credited: number;
  balance: number;
}

export interface Config {
  odds: OddsRow[];
  cratePrice: number;
  startingBalance: number;
  discordEnabled: boolean;
  /** Auction timers turn urgent (and a bid adds time) in this last stretch. */
  antiSnipeMs: number;
  /** Most items one recycle (or one "Select all") can take. */
  recycleMaxItems: number;
  /** Economy numbers the game quotes in its copy (staff can change them). */
  freeCaseMinutes: number;
  freeCaseMax: number;
  marketFeePct: number;
  bidStepPct: number;
  antiSnipeMinutes: number;
  tradeExpiryDays: number[];
  tradeupSize: number;
}

/** Search suggestion: a skin the viewer owns (inventory) or that is listed (market). */
export interface SkinSuggestion {
  skin: SkinCard;
  /** Copies owned (inventory) or active listings (market). */
  count: number;
}

export type SuggestScope = 'inventory' | 'market';

/** Weapon finder of the Cases screen (`GET /crates/find?q=`). Doppler phases are merged under one name. */
export interface CaseFinder {
  /** Cases that drop a matching skin, newest first. */
  crates: {
    id: string;
    /** Best matches of this case: 3 at most, or all of them with `?crate=`. */
    matches: SkinCard[];
    matchCount: number;
  }[];
  /** Suggestions under the field (8 at most), with the cases that drop each one. */
  skins: { skin: SkinCard; crateIds: string[] }[];
}

export interface GuestSummary {
  recentItems: Item[];
  itemCount: number;
  balance: number;
  casesOpened: number;
  bestAlbum: { crateName: string; owned: number; total: number } | null;
}

export type AuthFlowStatus = 'pending' | 'success' | 'error';

export interface AuthFlowStart {
  flowId: string;
  pollSecret: string;
  authorizeUrl: string;
}

export interface AuthFlowState {
  status: AuthFlowStatus;
  /** On success: the account now signed in. */
  me?: Me;
  error?: string;
}

export interface ActivityAuthResult {
  sessionToken: string;
  accessToken: string;
  me: Me;
}

// ── Phase 3: item page and albums ───────────────────────────────────────────

/** "2,500 × 2 StatTrak™ × 1.2 MW": computed by the server, the page only prints it. */
export interface RecycleBreakdown {
  base: number;
  stattrakMultiplier: number | null;
  wear: { code: WearCode; multiplier: number } | null;
}

export interface ItemDetail extends Item {
  owner: { username: string | null; isYou: boolean };
  /** Only the owner can recycle or showcase, and only an available item. */
  canRecycle: boolean;
  inShowcase: boolean;
  /** How the current owner got it. */
  acquiredVia: 'case' | 'trade' | 'market' | 'tradeup' | 'admin';
  /** Owner, account, available item: "List on market". */
  canList: boolean;
  /** The open auction when the item is listed. */
  listing: { auctionId: string; endsAt: string } | null;
  /** "Recent sales · StatTrak™ MW · 30 days". */
  sales: SalesHistory;
  /** Public number, shown as "ID 000482113". */
  serial: number;
  collection: { id: string; name: string } | null;
  source: 'case' | 'tradeup' | 'admin';
  originalOwner: { name: string; isYou: boolean } | null;
  recycleBreakdown: RecycleBreakdown;
}

export interface AlbumSummary {
  /** Album = the obtainable normal skins of a case; the id is the case id. */
  id: string;
  name: string;
  crate: { id: string; name: string; imageUrl: string };
  owned: number;
  total: number;
}

/** Best copy owned of a skin: lowest float (vanilla knives have none). */
export interface AlbumBest {
  itemId: string;
  float: number | null;
  wear: Wear | null;
  stattrak: boolean;
}

export interface AlbumSkin extends SkinCard {
  best: AlbumBest | null;
}

export interface AlbumDetail {
  album: AlbumSummary;
  groups: { tier: Exclude<Tier, 'gold'>; owned: number; total: number; skins: AlbumSkin[] }[];
  /** ★ finishes of this case the player owns (not part of the completion). */
  special: AlbumSkin[];
}

// ── Phase 4: friends, profiles, showcase, feed ──────────────────────────────

export type Relation = 'self' | 'friend' | 'incoming' | 'outgoing' | 'none';

export interface PlayerRef {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
}

/** "≈ 64,800 CR · albums 29%" */
export interface PlayerStats {
  inventoryValue: number;
  /** Normal case skins collected / all of them, in percent (also the phase 7 album ranking). */
  albumsPct: number;
}

export interface PlayerCard extends PlayerRef {
  stats: PlayerStats;
  relation: Relation;
}

export interface FriendCard extends PlayerCard {
  /** ISO date the request was accepted. */
  since: string;
  /** Rarity of each showcased item, in order (mini showcase). */
  showcase: Tier[];
}

export interface FriendsOverview {
  friends: FriendCard[];
  incoming: PlayerCard[];
  outgoing: PlayerCard[];
}

export interface ProfileStats {
  casesOpened: number;
  inventoryValue: number;
  tradesCompleted: number;
  skinsCollected: number;
  albumsPct: number;
}

export interface Profile {
  player: PlayerRef;
  relation: Relation;
  joinedAt: string;
  friendsSince: string | null;
  /** Up to 5 items, position order; the first is the main one. */
  showcase: Item[];
  stats: ProfileStats;
  /** Started albums only, most complete first (6 at most). */
  albums: AlbumSummary[];
  /** Inventory and album details: yourself and friends only. */
  canViewCollection: boolean;
  /** Places among all players ("#18 by inventory value", "#7 by albums"). */
  ranks: { value: number; albums: number };
}

export interface FeedEntry {
  id: number;
  type: 'unbox' | 'sale' | 'tradeup';
  player: PlayerRef;
  item: Item;
  /** Sale price, for `sale`. */
  price: number | null;
  createdAt: string;
}

// ── Phase 5: trades ─────────────────────────────────────────────────────────

export type TradeStatus = 'pending' | 'accepted' | 'declined' | 'cancelled' | 'expired';

/** "Album +1": the item would fill an empty slot in one of the viewer's albums. */
export interface TradeItem extends Item {
  albumGain: boolean;
}

export interface TradeSideView {
  items: TradeItem[];
  credits: number;
  /** Items + credits, server estimate ("≈ 2,500 CR"). */
  total: number;
}

/** An offer seen from the viewer: "give" is always what the viewer hands over. */
export interface TradeOffer {
  id: string;
  direction: 'received' | 'sent';
  status: TradeStatus;
  /** Cancelled by staff (a moderator, or a ban): "Cancelled by staff". */
  byStaff: boolean;
  counterparty: PlayerRef;
  createdAt: string;
  expiresAt: string;
  respondedAt: string | null;
  give: TradeSideView;
  get: TradeSideView;
  /** get.total − give.total: "Estimated +500 CR for you". */
  diff: number;
  /** Distinct skins received that fill an empty album slot. */
  albumSlots: number;
}

export interface TradeOptions {
  partner: PlayerRef;
  /** Your balance. */
  balance: number;
  /** The friend's balance, so you know how much you can ask for. */
  partnerBalance: number;
  /** Your items (locked ones included, to show them greyed). */
  mine: TradeItem[];
  /** The friend's items, with "Album +1" for you. */
  theirs: TradeItem[];
}

export interface TradeQuote {
  giveTotal: number;
  getTotal: number;
  diff: number;
  albumSlots: number;
}

export interface CreateTradeBody {
  to: string;
  giveItemIds: string[];
  askItemIds: string[];
  giveCredits: number;
  askCredits: number;
  /** One of Config.tradeExpiryDays. */
  expiresInDays: number;
  /** Answering an offer you received: it is declined when this one is sent. */
  counterOf?: string;
}

/** Result of accept / decline / cancel. An offer that can no longer go through is cancelled. */
export interface TradeActionResult {
  status: TradeStatus;
  /** Why an accept turned into a cancellation. */
  reason?: string;
  balance: number;
}

// ── Phase 6: market ─────────────────────────────────────────────────────────

export type AuctionStatus = 'active' | 'sold' | 'unsold' | 'cancelled';
export type MarketTab = 'browse' | 'mine' | 'bids';
export type MarketSort = 'ending' | 'newest' | 'price' | 'bids';

/** The viewer in an auction: their listing, or their bids (leading / outbid, then won / lost). */
export type AuctionRole = 'seller' | 'leading' | 'outbid' | 'won' | 'lost' | null;

export interface AuctionCard {
  id: string;
  item: Item;
  status: AuctionStatus;
  startPrice: number;
  /** Highest bid, null before the first one. */
  currentBid: number | null;
  bidCount: number;
  buyNowPrice: number | null;
  createdAt: string;
  endsAt: string;
  closedAt: string | null;
  finalPrice: number | null;
  role: AuctionRole;
}

export interface MarketPage {
  auctions: AuctionCard[];
  hasMore: boolean;
  /** Tab counts, filters ignored: live auctions of others, your active listings, auctions you bid on. */
  counts: { browse: number; mine: number; bids: number };
  maxListings: number;
  /** For the countdowns: the client only offsets its clock, the server decides when it ends. */
  serverNow: string;
}

/** Sales of one skin, StatTrak or not, in one wear (null = vanilla knife). Points oldest first. */
export interface SalesHistory {
  stattrak: boolean;
  wear: WearCode | null;
  count: number;
  average: number | null;
  last: number | null;
  points: { price: number; at: string }[];
  /** Window of the curve (30 days on the item page). */
  from: string;
  to: string;
}

export interface AuctionBid {
  player: PlayerRef;
  amount: number;
  createdAt: string;
  isYou: boolean;
}

export interface QuickBid {
  label: string;
  amount: number;
}

export interface AuctionDetail extends AuctionCard {
  seller: PlayerRef;
  durationHours: number;
  leader: PlayerRef | null;
  buyer: PlayerRef | null;
  boughtNow: boolean;
  /** Seller's fee once sold (shown to the seller only). */
  fee: number | null;
  /** Fee rate this auction pays (set when it was listed). */
  feePct: number;
  /** Latest first. */
  bids: AuctionBid[];
  minNextBid: number;
  quickBids: QuickBid[];
  /** Signed in, not the seller, not already leading, still running. */
  canBid: boolean;
  canBuyNow: boolean;
  /** Seller, while nobody has bid. */
  canCancel: boolean;
  /** Last sales of this skin and wear. */
  sales: SalesHistory;
  serverNow: string;
}

export interface BidResult {
  auction: AuctionDetail;
  balance: number;
  heldInBids: number;
  /** The bid landed in the last 2 minutes and added 2 minutes. */
  extended: boolean;
}

export interface BuyNowResult {
  auction: AuctionDetail;
  balance: number;
  heldInBids: number;
}

export interface SellInfo {
  item: Item;
  sales: SalesHistory;
  activeListings: number;
  maxListings: number;
  maxPrice: number;
  durations: number[];
}

export interface ListingQuote {
  /** Net for the seller if it sells at the starting price / at the buy-now price. */
  atStart: number;
  atBuyNow: number | null;
  /** 5 % fee at the starting price. */
  feeAtStart: number;
  recycleValue: number;
}

export interface CreateListingBody {
  itemId: string;
  startPrice: number;
  buyNowPrice: number | null;
  /** One of the durations staff allow (SellInfo.durations). */
  durationHours: number;
}

export interface CreateListingResult {
  id: string;
  endsAt: string;
  activeListings: number;
}

// ── Phase 7: trade-up contracts, leaderboard, global drops ─────────────────

/** One possible result of a contract: chance, float it would land at, and whether it fills an album slot. */
export interface TradeUpOutcome {
  skin: SkinCard;
  /** Percent, e.g. 14.29 */
  pct: number;
  float: number;
  wear: Wear;
  albumGain: boolean;
  collection: { id: string; name: string };
}

export interface TradeUpOptions {
  tier: Tier;
  stattrak: boolean;
  next: Tier;
  /** Your items of this rarity (locked ones included, to show them greyed). */
  items: Item[];
  size: number;
  /** Rarities that can go in a contract (Covert, knives and gloves: not yet). */
  tiers: Tier[];
}

export interface TradeUpQuote {
  count: number;
  size: number;
  next: Tier | null;
  stattrak: boolean | null;
  avgFloat: number | null;
  /** Most likely first. */
  outcomes: TradeUpOutcome[];
}

export interface TradeUpResult {
  id: string;
  item: Item;
  albumGain: boolean;
}

export type LeaderboardBoard = 'value' | 'albums';
export type LeaderboardScope = 'all' | 'friends';

export interface LeaderboardEntry {
  rank: number;
  player: PlayerRef;
  /** Inventory value (CR) or skins collected, depending on the board. */
  metric: number;
  /** Value board: the most valuable item. */
  best: SkinCard | null;
  /** Albums board: albums fully collected. */
  completeAlbums: number;
  isYou: boolean;
  isFriend: boolean;
}

export interface Leaderboard {
  board: LeaderboardBoard;
  scope: LeaderboardScope;
  entries: LeaderboardEntry[];
  /** Your own row, also when you are below the list (null for guests). */
  you: LeaderboardEntry | null;
}

/** Latest knife or gloves unboxed by anyone (global banner). `player` is null for a guest. */
export interface GlobalDrop {
  id: number;
  player: PlayerRef | null;
  item: Item;
  createdAt: string;
}

// ── Admin panel (docs/ADMIN.md) ────────────────────────────────────────────
// Every admin action returns `toast`: the past-tense sentence ending in "· logged".

export interface AdminActionResult {
  toast: string;
}

export interface AdminMe {
  name: string;
  role: StaffRole;
  avatarUrl: string | null;
  /** Sidebar badges: open flags (Market & trades) and open reports (Moderation). */
  badges: { flags: number; reports: number };
  /** Server clock (ISO): the top bar shows it in UTC. */
  now: string;
}

export interface AdminPlayerHit {
  id: string;
  label: string;
  discordId: string | null;
  isGuest: boolean;
  avatarUrl: string | null;
  banned: boolean;
  online: boolean;
  lastSeenAt: string;
}

export interface AdminItemHit {
  id: string;
  serial: string;
  name: string;
  tier: Tier;
}

export interface AdminSearch {
  players: AdminPlayerHit[];
  items: AdminItemHit[];
}

/** One "before → after" line of a confirmation. */
export interface DiffRow {
  label: string;
  before: string;
  after: string;
}

// Players

export type AdminPlayerSort = 'seen' | 'balance' | 'value' | 'joined';

export interface AdminPlayerRow {
  id: string;
  label: string;
  discordId: string | null;
  isGuest: boolean;
  avatarUrl: string | null;
  balance: number;
  inventoryValue: number;
  casesOpened: number;
  joinedAt: string;
  lastSeenAt: string;
  online: boolean;
  /** "7 d", "24 h", "30 d", "Permanent" while banned. */
  ban: string | null;
  flagged: boolean;
}

export interface AdminPlayersPage {
  rows: AdminPlayerRow[];
  total: number;
  next: number | null;
  /** Unfiltered counts (header and mobile chips). */
  counts: { all: number; accounts: number; guests: number; flagged: number; banned: number };
}

export interface AdminBan {
  since: string;
  until: string | null;
  by: string;
  reason: string;
  /** "7 d", "Permanent" */
  duration: string;
}

export interface AdminSignal {
  key: 'age' | 'ip' | 'flags' | 'reports';
  value: string;
  alert: boolean;
  /** Sub-line ("tomb, Guest #2b7e, Guest #e310"), with an optional link inside the panel. */
  sub: string | null;
  to: string | null;
}

export interface AdminPlayer {
  id: string;
  label: string;
  discordId: string | null;
  isGuest: boolean;
  deleted: boolean;
  avatarUrl: string | null;
  joinedAt: string;
  lastSeenAt: string;
  online: boolean;
  ban: AdminBan | null;
  stats: { balance: number; heldInBids: number; inventoryValue: number; casesOpened: number; tradesCompleted: number; albumsPct: number };
  signals: AdminSignal[];
  /** Live sessions (Sign out everywhere). */
  sessions: number;
  /** Free cases ready in the stack (what Refill tops up), out of `freeCaseMax`. Bonus cases not included. */
  freeCases: number;
  freeCaseMax: number;
  /** When the stack gains its next free case (null = full). */
  freeCaseNextAt: string | null;
  /** Name the server would give on Rename ("player_8841"). */
  renameTo: string;
}

export type AdminPlayerTab = 'inventory' | 'openings' | 'trades' | 'market' | 'friends' | 'ledger' | 'sessions' | 'notes';

export interface AdminLedgerRow {
  id: number;
  at: string;
  type: string;
  amount: number;
  balanceAfter: number;
  details: string;
}

export type ChipStyle = 'solid' | 'outline' | 'dashed' | 'flag';

/** A generic row of the player tabs (Openings, Trades, Market, Friends, Sessions). */
export interface AdminRecord {
  /** Time or reference shown first ("#2231 · Oct 16"); when null, the client formats `at`. */
  lead: string | null;
  at: string | null;
  title: string;
  tier: Tier | null;
  meta: string | null;
  value: string | null;
  chip: { text: string; style: ChipStyle } | null;
  /** Panel route to open (an item, a player). */
  to: string | null;
}

export interface AdminItemCard {
  id: string;
  serial: string;
  weaponName: string;
  finishName: string | null;
  tier: Tier;
  imageUrl: string;
  wear: WearCode | null;
  float: number | null;
  stattrak: boolean;
  status: ItemStatus;
  stuck: boolean;
  value: number;
}

export interface AdminNote {
  id: number;
  staffName: string;
  at: string;
  text: string;
}

export interface AdminPlayerTabData {
  ledger?: AdminLedgerRow[];
  records?: AdminRecord[];
  inventory?: { items: AdminItemCard[]; counts: { all: number; available: number; listed: number; in_trade: number } };
  notes?: AdminNote[];
}

export interface CreditsPreview {
  before: number;
  after: number;
  held: number;
  /** "vex only has 4,870 CR. Remove 4,870 CR or less." */
  blocked: string | null;
  max: number;
}

export interface AdminSkinHit {
  id: string;
  name: string;
  weaponName: string;
  finishName: string | null;
  tier: Tier;
  imageUrl: string;
  minFloat: number | null;
  maxFloat: number | null;
  stattrakAvailable: boolean;
}

export interface GrantQuote {
  /** Why the item can't be granted as is (float out of range…). */
  error: string | null;
  value: number;
  inventoryBefore: number;
  inventoryAfter: number;
}

export type BanDuration = '24h' | '7d' | '30d' | 'permanent';

export interface BanPreview {
  sessions: number;
  listings: { item: string; bids: number; leader: string | null; leading: number | null }[];
  bids: { item: string; amount: number }[];
  offers: number;
  until: Record<Exclude<BanDuration, 'permanent'>, string>;
}

export interface DeletePreview {
  balance: number;
  items: number;
  itemsValue: number;
  friends: number;
  sessions: number;
  albumsPct: number;
  trades: number;
  sales: number;
  ledgerEntries: number;
  listing: { item: string; bids: number } | null;
  ownBid: number | null;
}

// Items

export interface AdminItemRow {
  id: string;
  serial: string;
  name: string;
  tier: Tier;
  wear: WearCode | null;
  float: number | null;
  stattrak: boolean;
  owner: { id: string; label: string } | null;
  status: ItemStatus;
  stuck: boolean;
  obtainedAt: string;
}

export interface AdminItemsPage {
  rows: AdminItemRow[];
  total: number;
  next: number | null;
  /** All items and those destroyed in the last 7 days (subtitle). */
  counts: { all: number; destroyedWeek: number };
}

export type TimelineKind = 'normal' | 'end' | 'alert' | 'admin';

export interface TimelineEntry {
  at: string;
  /** Replaces the formatted time ("since Oct 19, 03:00"). */
  when: string | null;
  text: string;
  kind: TimelineKind;
  to: string | null;
}

export interface AdminItemDetail extends AdminItemRow {
  weaponName: string;
  finishName: string | null;
  imageUrl: string;
  pattern: number;
  minFloat: number | null;
  maxFloat: number | null;
  originCase: string | null;
  grantedBy: string | null;
  originalOwner: { id: string; label: string } | null;
  inShowcase: boolean;
  value: number;
  recycleValue: number;
  /** Stuck explanation ("Offer #2231 expired on Oct 19 at 03:00, but…"). */
  stuckNote: string | null;
  timeline: TimelineEntry[];
  /** Restore: who gets it back, the recycle credits that could be taken back, or why not. */
  restore: { owner: string; blocked: string | null; clawback: { amount: number; before: number; after: number; blocked: string | null } | null } | null;
  /** What a move cancels first. */
  listing: { number: number; bid: number | null; leader: string | null } | null;
  offer: { number: number; expired: boolean } | null;
}

export interface MovePreview {
  target: { id: string; label: string } | null;
  error: string | null;
}

// Overview

export type AdminPeriod = '24h' | '7d' | '30d';

export interface AdminKpi {
  key: 'players' | 'active' | 'cases' | 'circulation' | 'sales' | 'flags';
  value: number;
  /** Variation line ("+12% vs yesterday", "fees 18,420 CR"). */
  delta: string;
  spark: number[];
  alert: boolean;
}

export interface FlowBucket {
  start: string;
  starting: number;
  recycle: number;
  admin: number;
  cases: number;
  fees: number;
  removed: number;
}

export interface AdminJob {
  job: string;
  name: string;
  schedule: string;
  lastRunAt: string | null;
  ok: boolean | null;
  result: string | null;
  durationMs: number | null;
}

export interface AdminOverview {
  period: AdminPeriod;
  kpis: AdminKpi[];
  players: { accounts: number; guests: number };
  flow: { unit: 'hour' | 'day'; buckets: FlowBucket[]; created: number; destroyed: number; net: number };
  drops: { sample: number; rows: { tier: Tier; setPct: number; actualPct: number; ratio: number }[]; normal: boolean; verdict: string };
  jobs: AdminJob[];
  catalog: { commit: string | null; importedAt: string | null; cases: number; active: number; caseOfDay: string | null; warnings: { crateId: string; text: string }[] };
  recent: AdminLogEntry[];
}

// Catalog

export interface AdminCrateRow {
  id: string;
  name: string;
  imageUrl: string;
  releasedOn: string | null;
  normalCount: number;
  hasGold: boolean;
  active: boolean;
  isNew: boolean;
  price: number;
  opened7d: number;
  caseOfDay: boolean;
  brokenImages: number;
}

export interface ImportReport {
  id: string;
  from: string | null;
  to: string;
  casesAdded: number;
  skinsAdded: number;
  skinsAddedInNewCases: number;
  skinsRemoved: number;
  casesRemoved: number;
  brokenImages: string[];
  fixedImages: string[];
}

export interface AdminCatalog {
  commit: string | null;
  importedAt: string | null;
  caseCount: number;
  skinCount: number;
  caseOfDay: { id: string; name: string } | null;
  rows: AdminCrateRow[];
  imports: { commit: string; what: string; by: string | null; at: string }[];
}

export interface AdminCrateDetail extends AdminCrateRow {
  groups: { tier: Tier; count: number; skins: { id: string; weaponName: string; finishName: string | null; imageUrl: string; broken: boolean }[]; gold: { title: string; finishes: number } | null }[];
  last30: { total: number; rows: { tier: Tier; count: number; pct: number }[] };
  broken: { name: string; reason: string }[];
  /** Who turned it off and when (from the admin log). */
  off: { by: string; at: string } | null;
}

// Admin log

export interface AdminLogEntry {
  id: number;
  at: string;
  staff: string;
  action: string;
  targetType: string;
  targetId: string | null;
  targetLabel: string;
  /** Panel route of the target, if it still exists. */
  to: string | null;
  change: string;
  reason: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  details: Record<string, unknown> | null;
}

export interface AdminLogPage {
  rows: AdminLogEntry[];
  total: number;
  next: number | null;
  staff: string[];
}

// Economy settings (admin › Economy)

export type EconomyGroupId = 'cases' | 'rarity' | 'stattrak' | 'market' | 'trades';

export interface EconomySetting {
  key: string;
  label: string;
  help: string;
  unit: string;
  tier: Tier | null;
  /** Current value as staff type it ("250", "79.92", "1.5·1.2·1·0.9·0.8"). */
  value: string;
  /** "Changed Oct 3 by mathys", "Recycle changed Oct 19 by mathys". */
  changed: string | null;
}

export interface EconomyGroup {
  id: EconomyGroupId;
  title: string;
  settings: EconomySetting[];
}

/** Average return per case if the player recycles everything they open. */
export interface EconomySim {
  average: number;
  /** Share of the case price that comes back, 0–1. */
  share: number;
  price: number;
  min: number;
  max: number;
}

export interface EconomyHistoryRow {
  id: number;
  at: string;
  staff: string;
  key: string;
  change: string;
  reason: string;
}

export interface AdminEconomy {
  groups: EconomyGroup[];
  /** "100.00" */
  oddsTotal: string;
  sim: EconomySim;
  history: EconomyHistoryRow[];
}

export interface EconomyDiffRow {
  key: string;
  /** "Case price", "Recycle Covert". */
  label: string;
  /** "250 CR" */
  from: string;
  to: string;
}

/** What staff typed, checked by the server: errors per key, the diff, the simulator and what changes. */
export interface EconomyPreview {
  errors: Record<string, string>;
  oddsTotal: string;
  oddsOk: boolean;
  diff: EconomyDiffRow[];
  /** Null while something is invalid. */
  sim: EconomySim | null;
  impacts: string[];
  valid: boolean;
  /** "Odds add up to 99.50%. They must make 100.00% to save." */
  invalidText: string | null;
}

// Market & trades (admin)

export type AdminAuctionKind = 'live' | 'urgent' | 'overdue' | 'sold' | 'unsold' | 'cancelled';

export interface AdminPersonRef {
  id: string;
  label: string;
}

export interface AdminAuctionRow {
  id: string;
  /** "#8820" */
  number: string;
  name: string;
  tier: Tier;
  wear: string | null;
  stattrak: boolean;
  seller: AdminPersonRef;
  /** Current bid, or the start price when nobody bid. */
  bid: number;
  /** "4 bids · kenji", "No bids · start price". */
  bidsLine: string;
  buyNow: number | null;
  kind: AdminAuctionKind;
  /** "4 h 51 min", "1:42", "ended 13:58", "Oct 22, 22:00". */
  ends: string;
  /** "Live", "Overdue", "Settled", "Not sold", "Cancelled by lea". */
  status: string;
  /** Red dot: overdue, or flagged by the market monitor. */
  flagged: boolean;
}

export interface AdminAuctionsPage {
  rows: AdminAuctionRow[];
  next: number | null;
  /** "23 live · 1 overdue · 134 sold in 24 h" */
  summary: string;
  live: number;
}

export interface AdminConfirmText {
  title: string;
  lines: string[];
  button: string;
}

export interface AdminAuctionDetail extends AdminAuctionRow {
  weaponName: string;
  finishName: string;
  imageUrl: string;
  /** "Field-Tested" */
  wearName: string | null;
  /** "Ends in 4 h 51 min", "Ended 14 min ago · not settled", "Settled". */
  timer: string;
  facts: { k: string; v: string }[];
  bids: { who: AdminPersonRef; amount: number; at: string; leading: boolean }[];
  bidCount: number;
  /** Null when the action doesn't apply (with the reason in `cancelHint`). */
  cancel: AdminConfirmText | null;
  cancelHint: string | null;
  settle: AdminConfirmText | null;
}

export interface AdminTradeRow {
  id: string;
  number: string;
  from: AdminPersonRef;
  to: AdminPersonRef;
  give: string;
  giveValue: string;
  get: string;
  getValue: string;
  status: string;
  chip: 'outline' | 'flag' | 'dashed' | 'solid';
  /** "in 2 d 23 h", or "—". */
  expires: string;
  live: boolean;
  /** "Item still locked" (links to stuck items). */
  note: string | null;
  /** Confirmation text for a staff cancel ("… goes back to vex and … stays with kenji."). */
  cancelText: string | null;
}

export interface AdminTradesPage {
  rows: AdminTradeRow[];
  next: number | null;
  pending: number;
}

export interface AdminFlag {
  id: number;
  kind: string;
  urgent: boolean;
  open: boolean;
  /** "Raised Oct 23, 08:00 · trade monitor", with how it was handled appended once closed. */
  raised: string;
  /** "Open", "Dismissed by lea", "Handled". */
  state: string;
  players: { id: string; label: string; banned: boolean }[];
  /** "+5 more" */
  morePlayers: number;
  evidence: { v: string; k: string }[];
  text: string;
}

export interface AdminFlags {
  rows: AdminFlag[];
  open: number;
}

// Moderation (admin)

export type ReportCategory = 'Offensive name' | 'Scam' | 'Other';

export interface AdminReport {
  id: number;
  category: ReportCategory;
  urgent: boolean;
  open: boolean;
  target: AdminPersonRef;
  /** An open "Offensive name" report: the name stays hidden until staff click "Show name". */
  hideName: boolean;
  /** "reported by dune · Oct 23, 12:31" */
  meta: string;
  reporter: string;
  message: string;
  /** "Handled · renamed to player_5120 by lea, Oct 21 20:14", "Dismissed by lea, Oct 23 12:40". */
  handled: string | null;
  /** Free name for "Rename" (players only, open reports). */
  suggestedName: string | null;
  isGuest: boolean;
}

export interface AdminDrop {
  id: number;
  item: string;
  /** "FN 0.0312" */
  wear: string;
  player: AdminPersonRef | null;
  hideName: boolean;
  at: string;
  hidden: boolean;
  /** "Shown in banner", "Hidden by lea". */
  state: string;
}

export interface AdminAnnouncement {
  id: number;
  state: 'Live' | 'Scheduled' | 'Ended';
  text: string;
  /** "Oct 22, 09:35 → Oct 25, 00:00" */
  when: string;
}

export interface AdminCost {
  k: string;
  v: string;
}

export interface AdminModeration {
  reports: AdminReport[];
  openReports: number;
  drops: AdminDrop[];
  announcements: AdminAnnouncement[];
  /** Max announcement length (140). */
  maxText: number;
  freeCase: { text: string; costs: AdminCost[]; button: string; players: number };
}

export interface GiftPreview {
  costs: AdminCost[];
  button: string;
  players: number;
}

/** The banner every player sees (desktop above the global drop, mobile under the header). */
export interface Announcement {
  id: number;
  text: string;
}

// Logs & tools: Ledger, Jobs, Errors

export interface AdminLedgerEntry extends AdminLedgerRow {
  player: AdminPersonRef;
}

export interface AdminLedgerPage {
  rows: AdminLedgerEntry[];
  next: number | null;
  /** Last "Ledger check" run (job or button), shown until staff run a new one. */
  lastCheck: { ok: boolean; at: string; result: string } | null;
}

export interface LedgerCheckResult {
  ok: boolean;
  players: number;
  entries: number;
  mismatches: { userId: string; label: string; text: string }[];
  at: string;
}

export interface AdminJobCard extends AdminJob {
  status: 'OK' | 'Warning' | 'Failed' | 'Never run';
  /** ISO of the next scheduled run. */
  nextAt: string;
  note: string | null;
  link: { label: string; to: string } | null;
}

export interface AdminErrors {
  codes: { code: string; count: number; hint: string; alert: boolean }[];
  errors: { at: string; code: string; route: string; count: number; message: string }[];
}
