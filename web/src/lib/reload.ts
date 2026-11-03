const KEY = 'mint.reloadedAt';

/** True for the error a browser throws when a lazy chunk from an older deploy no longer exists. */
export function isStaleChunkError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /dynamically imported module|Importing a module script failed|Failed to fetch module|Unable to preload CSS/i.test(message);
}

/**
 * Reloads the page, at most once every 30 s, so a new deploy is picked up without looping on a real
 * failure. Returns false when it already reloaded recently.
 */
export function reloadOnce(): boolean {
  const now = Date.now();
  try {
    const last = Number(sessionStorage.getItem(KEY) ?? 0);
    if (now - last < 30_000) return false;
    sessionStorage.setItem(KEY, String(now));
  } catch {
    // Storage blocked: reload anyway, the browser's own history stops a loop soon enough.
  }
  window.location.reload();
  return true;
}
