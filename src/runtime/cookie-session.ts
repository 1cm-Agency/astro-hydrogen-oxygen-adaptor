import type { HydrogenSessionManager } from '../config.js';

export interface CookieSessionOptions {
  /**
   * Cookie name. Defaults to `__Host-session` when the cookie is Secure and `session` otherwise.
   * Browsers only accept the `__Host-` prefix on Secure, Path=/ cookies without a Domain, so
   * the prefix is applied only when those rules can be met; it stops subdomains and
   * insecure origins from planting or shadowing the session.
   */
  name?: string;
  /** Lifetime in seconds. @default 2592000 (30 days) */
  maxAge?: number;
  /** @default 'Lax' (Strict would drop the session on the OAuth redirect back from Shopify) */
  sameSite?: 'Lax' | 'Strict' | 'None';
  /** @default true when the request URL is https */
  secure?: boolean;
  /** @default '/' (required by the `__Host-` prefix) */
  path?: string;
}

export interface CreateCookieSessionManagerArgs {
  request: Request;
  /** Secret that encrypts and authenticates the cookie, e.g. `SESSION_SECRET`. */
  secret: string;
  cookie?: CookieSessionOptions;
}

/** Browsers drop cookies over about 4096 bytes (name and attributes included). */
export const COOKIE_SIZE_LIMIT = 4096;

const DEFAULT_MAX_AGE = 60 * 60 * 24 * 30;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const keyCache = new Map<string, Promise<CryptoKey>>();
let warnedAboutSize = false;

/**
 * A session stored entirely in an encrypted cookie, so it survives across requests with no
 * server-side storage (Oxygen has none). The payload is JSON encrypted with AES-GCM using a key
 * derived from `secret`, so tokens kept in it (Customer Account access, refresh and ID tokens)
 * are neither readable nor modifiable by the browser.
 *
 * Values must be JSON-serializable. The session is decrypted lazily on first read. A cookie that
 * is missing, tampered with, expired, or encrypted with another secret yields an empty session;
 * nothing throws. `commit()` returns a `set-cookie` header only when the session changed.
 */
export function createCookieSessionManager({
  request,
  secret,
  cookie = {},
}: CreateCookieSessionManagerArgs): HydrogenSessionManager {
  const url = new URL(request.url);
  const secure = cookie.secure ?? url.protocol === 'https:';
  const name = cookie.name ?? (secure ? '__Host-session' : 'session');
  const path = cookie.path ?? '/';
  const maxAge = cookie.maxAge ?? DEFAULT_MAX_AGE;
  const sameSite = cookie.sameSite ?? 'Lax';
  const incoming = readCookie(request.headers.get('cookie'), name);

  let data: Map<string, unknown> | undefined;
  let loading: Promise<Map<string, unknown>> | undefined;
  let dirty = false;

  const load = (): Promise<Map<string, unknown>> => {
    if (data) return Promise.resolve(data);
    return (loading ??= (async () => {
      const entries = incoming ? await decrypt(incoming, secret, name) : undefined;
      return (data = new Map(entries ? Object.entries(entries) : []));
    })());
  };

  const attributes = (age: number) =>
    [`Path=${path}`, `Max-Age=${age}`, 'HttpOnly', `SameSite=${sameSite}`, ...(secure ? ['Secure'] : [])].join('; ');

  return {
    getSessionOrigin: () => url.origin,
    getSessionItem: async (key) => (await load()).get(key),
    setSessionItem: async (key, value) => {
      (await load()).set(key, value);
      dirty = true;
    },
    removeSessionItem: async (key) => {
      if ((await load()).delete(key)) dirty = true;
    },
    commit: async () => {
      if (!dirty) return;
      const map = await load();
      if (map.size === 0) {
        // Nothing to store: expire the cookie, but only if the browser sent one.
        return incoming ? { 'set-cookie': `${name}=; ${attributes(0)}` } : undefined;
      }
      const value = await encrypt(Object.fromEntries(map), secret, name, maxAge);
      const header = `${name}=${value}; ${attributes(maxAge)}`;
      if (header.length > COOKIE_SIZE_LIMIT && !warnedAboutSize) {
        warnedAboutSize = true;
        console.warn(
          `[astro-hydrogen] The "${name}" session cookie is ${header.length} bytes, over the ~${COOKIE_SIZE_LIMIT} byte browser limit, so browsers may drop it and customers will be signed out. Store less in the session.`,
        );
      }
      return { 'set-cookie': header };
    },
  };
}

function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq !== -1 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

function getKey(secret: string): Promise<CryptoKey> {
  let key = keyCache.get(secret);
  if (!key) {
    key = crypto.subtle
      .importKey('raw', encoder.encode(secret), 'HKDF', false, ['deriveKey'])
      .then((material) =>
        crypto.subtle.deriveKey(
          { name: 'HKDF', hash: 'SHA-256', salt: encoder.encode('astro-hydrogen'), info: encoder.encode('session-cookie') },
          material,
          { name: 'AES-GCM', length: 256 },
          false,
          ['encrypt', 'decrypt'],
        ),
      );
    if (keyCache.size > 8) keyCache.clear();
    keyCache.set(secret, key);
  }
  return key;
}

async function encrypt(values: Record<string, unknown>, secret: string, name: string, maxAge: number): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = encoder.encode(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + maxAge, d: values }));
  const cipher = await crypto.subtle.encrypt(
    // The cookie name is authenticated, so a value can't be replayed under another name.
    { name: 'AES-GCM', iv, additionalData: encoder.encode(name) },
    await getKey(secret),
    plaintext,
  );
  const out = new Uint8Array(iv.length + cipher.byteLength);
  out.set(iv);
  out.set(new Uint8Array(cipher), iv.length);
  return toBase64Url(out);
}

async function decrypt(value: string, secret: string, name: string): Promise<Record<string, unknown> | undefined> {
  try {
    const bytes = fromBase64Url(value);
    if (bytes.length <= 12 + 16) return undefined;
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: bytes.slice(0, 12), additionalData: encoder.encode(name) },
      await getKey(secret),
      bytes.slice(12),
    );
    const payload = JSON.parse(decoder.decode(plaintext)) as { exp?: unknown; d?: unknown };
    if (typeof payload.exp !== 'number' || payload.exp < Date.now() / 1000) return undefined;
    if (!payload.d || typeof payload.d !== 'object' || Array.isArray(payload.d)) return undefined;
    return payload.d as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array {
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
