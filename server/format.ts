// Text the server builds for staff screens and messages. Times are always UTC.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');

/** "Oct 30" */
export const utcDay = (d: Date) => `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
/** "Oct 30, 14:12" */
export const utcDateTime = (d: Date) => `${utcDay(d)}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
/** "Oct 30 14:12" (tables) */
export const utcStamp = (d: Date) => `${utcDay(d)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;

/** "4,870" */
export const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
/** "4,870 CR" */
export const cr = (n: number) => `${fmt(n)} CR`;
/** "+5,000 CR" / "−5,000 CR" (true minus sign) */
export const signedCr = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmt(Math.abs(n))} CR`;
/** 9-digit item number: "000482113" */
export const serial = (n: number) => String(n).padStart(9, '0');

/** "just now", "12 min ago", "3 h ago", "yesterday", "4 d ago" */
export function ago(d: Date, now = new Date()): string {
  const min = Math.floor((now.getTime() - d.getTime()) / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  const days = Math.floor(h / 24);
  return days === 1 ? 'yesterday' : `${days} d ago`;
}

/** "5 h", "12 min", "2 d" until a date */
export function inTime(d: Date, now = new Date()): string {
  const min = Math.max(0, Math.ceil((d.getTime() - now.getTime()) / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.round(min / 60);
  return h < 48 ? `${h} h` : `${Math.round(h / 24)} d`;
}

export const plural = (n: number, one: string, many = `${one}s`) => `${fmt(n)} ${n === 1 ? one : many}`;
