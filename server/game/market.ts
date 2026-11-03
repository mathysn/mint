import { econ, QUICK_BIDS_BP } from './economy.js';

const BP = 10_000;

/** ⌈amount × bp / 10 000⌉ on integers (no floating-point surprise on exact values). */
const ceilBp = (amount: number, bp: number) => Math.floor((amount * bp + BP - 1) / BP);

/** The sale fee (5 % by default) of the final price, rounded up to the credit (money leaves the game). A listing keeps the fee it started with (`feeBp`). */
export const marketFee = (price: number, feeBp = econ().marketFeeBp) => ceilBp(price, feeBp);

/** What the seller receives. */
export const sellerNet = (price: number, feeBp = econ().marketFeeBp) => price - marketFee(price, feeBp);

/** First bid: the starting price. Then at least 5 % above the current bid, rounded up. */
export const minNextBid = (currentBid: number | null, startPrice: number) =>
  currentBid === null ? startPrice : ceilBp(currentBid, BP + econ().bidStepBp);

/** Quick-bid buttons: +5 / +10 / +25 % of the current bid (the starting price when nobody bid yet). */
export function quickBids(currentBid: number | null, startPrice: number): { label: string; amount: number }[] {
  if (currentBid === null) {
    return [{ label: 'Start', amount: startPrice }, ...QUICK_BIDS_BP.slice(1).map((bp) => ({ label: `+${bp / 100}%`, amount: ceilBp(startPrice, BP + bp) }))];
  }
  return QUICK_BIDS_BP.map((bp) => ({ label: `+${bp / 100}%`, amount: ceilBp(currentBid, BP + bp) }));
}

/** Anti-sniping: a bid in the last N minutes (2 by default) pushes the end back by N minutes. */
export function endAfterBid(endsAt: Date, now: Date): { endsAt: Date; extended: boolean } {
  const window = econ().antiSnipeMinutes * 60_000;
  if (window > 0 && endsAt.getTime() - now.getTime() <= window) {
    return { endsAt: new Date(endsAt.getTime() + window), extended: true };
  }
  return { endsAt, extended: false };
}
