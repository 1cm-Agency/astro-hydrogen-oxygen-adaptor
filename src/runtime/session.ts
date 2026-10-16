import type { HydrogenSessionManager } from '../config.js';

/**
 * A session that lives for one request. Enough for cart and predictive search handlers, which
 * keep their state in cookies. Customer Account handlers need a persistent session: provide one
 * with `sessionManager` in `src/hydrogen.config.ts`.
 */
export function createRequestSessionManager(request: Request): HydrogenSessionManager {
  const data = new Map<string, unknown>();
  const origin = new URL(request.url).origin;

  return {
    getSessionOrigin: () => origin,
    getSessionItem: (key) => data.get(key),
    setSessionItem: (key, value) => {
      data.set(key, value);
    },
    removeSessionItem: (key) => {
      data.delete(key);
    },
  };
}
