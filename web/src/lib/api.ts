import type { ApiError, BanInfo, ErrorCode } from '../../../shared/api';

/** Session token kept in memory inside the Discord activity (cookies are unreliable in its iframe). */
let bearer: string | null = null;
export const setBearer = (token: string | null) => {
  bearer = token;
};

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    /** Sent with 403 `banned`. */
    readonly ban?: BanInfo,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (bearer) headers.set('authorization', `Bearer ${bearer}`);
  let body = init.body;
  if (init.json !== undefined) {
    headers.set('content-type', 'application/json');
    body = JSON.stringify(init.json);
  }
  const res = await fetch(`/api${path}`, { ...init, headers, body, credentials: 'same-origin' });
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as T | ApiError | null;
  if (!res.ok) {
    const error = (data as ApiError | null)?.error;
    throw new ApiRequestError(res.status, error?.code ?? 'internal', error?.message ?? 'Network error.', error?.ban);
  }
  return data as T;
}
