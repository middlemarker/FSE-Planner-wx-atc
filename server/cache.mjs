/** Coalescing cache. Failed refreshes never replace the last good value or its source time. */
export function createCache(loader, ttl, { now = Date.now, retryMs = 30000 } = {}) {
  let value, nextAttempt = 0, pending, lastError = null;
  return {
    async get() {
      if (now() < nextAttempt) {
        if (value !== undefined) return value;
        throw new Error(lastError || 'Data unavailable; retry later');
      }
      if (!pending) pending = (async () => {
        try {
          const next = await Promise.resolve().then(loader);
          value = next; nextAttempt = now() + ttl; lastError = null;
        } catch (error) {
          lastError = error.message;
          nextAttempt = now() + Math.max(retryMs, error.retryAfterMs || 0);
          if (value === undefined) throw error;
        } finally { pending = null; }
        return value;
      })();
      return pending;
    },
    status() { return { available: value !== undefined, lastError, nextAttempt }; },
  };
}
