import { createHash } from 'node:crypto';
import { env } from '../env.js';
import type { AppContext } from '../http.js';

/** Salted hash of the caller's IP: guest limits and the same-IP signal. The IP itself is never stored. */
export function clientIpHash(c: AppContext): string | null {
  const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || c.req.header('x-real-ip');
  if (!ip) return null;
  return createHash('sha256').update(`${env().IP_HASH_SALT}:${ip}`).digest('hex');
}

/** "Chrome · Windows", "Safari · iPhone"; null when the user agent says nothing useful. */
export function deviceLabel(userAgent: string | undefined): string | null {
  if (!userAgent) return null;
  const ua = userAgent;
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Discord\//.test(ua)
      ? 'Discord app'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Chrome\/(\d+)/.test(ua)
          ? `Chrome ${ua.match(/Chrome\/(\d+)/)![1]}`
          : /Safari\//.test(ua)
            ? 'Safari'
            : null;
  const os = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Mac OS X|Macintosh/.test(ua)
            ? 'macOS'
            : /Linux/.test(ua)
              ? 'Linux'
              : null;
  const parts = [browser, os].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

export interface SessionMeta {
  device: string | null;
  ipHash: string | null;
  city: string | null;
  country: string | null;
}

/** What a new session records about where it was opened (Vercel adds the geo headers). */
export function sessionMeta(c: AppContext): SessionMeta {
  const city = c.req.header('x-vercel-ip-city');
  return {
    device: deviceLabel(c.req.header('user-agent')),
    ipHash: clientIpHash(c),
    city: city ? decodeURIComponent(city) : null,
    country: c.req.header('x-vercel-ip-country') ?? null,
  };
}
