// Display formatting only: every value comes from the server.

export const formatCredits = (n: number) => Math.round(n).toLocaleString('en-US');

/** 4 decimals on cards (0.2381), 9 on the reveal and item pages (0.238104546). */
export const formatFloat = (float: number, digits: 4 | 9) => float.toFixed(digits);

export const formatPct = (pct: number) => `${pct.toFixed(2)}%`;

/** hh:mm:ss until a date (Next reward / free case countdown). */
export function countdown(to: Date, now: Date): string {
  const total = Math.max(0, Math.floor((to.getTime() - now.getTime()) / 1000));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
}

/** "Sep 16" */
export const shortDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

/** "Sep 14, 2026" */
export const longDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

/** Feed times: "12 min", "3 h", "2 d" (compact: "12m", "3h", "2d"). */
export function timeAgo(iso: string, now: Date, compact = false): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000));
  const [value, unit] = minutes < 60 ? [Math.max(1, minutes), 'min'] : minutes < 1440 ? [Math.floor(minutes / 60), 'h'] : [Math.floor(minutes / 1440), 'd'];
  return compact ? `${value}${unit === 'min' ? 'm' : unit}` : `${value} ${unit}`;
}
