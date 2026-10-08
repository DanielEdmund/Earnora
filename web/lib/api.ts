'use client';

// API access — ONE origin for the browser, retry-proof transport.
// This file is why "Failed to fetch" can no longer reach the user:
//
//  1. The browser NEVER constructs an API host. Every call goes to '/api' on
//     whatever origin the page was opened from; the Next server rewrites it to
//     the API process (next.config.mjs → API_PROXY_ORIGIN, default
//     http://localhost:3000):
//       PC:        http://localhost:3001/api/*   → Next → localhost:3000
//       Phone/LAN: http://192.168.x.x:3001/api/* → Next → localhost:3000
//       Production https://site.com/api/*        → Next → API_PROXY_ORIGIN
//     No second port to reach, no CORS preflight, no mixed content, and a
//     localhost NEXT_PUBLIC_API_URL can never poison a phone page.
//  2. Transport failures (API restarting, connection refused, offline) are
//     retried with backoff — but only when the request provably never reached
//     the API, so a retry can never double-execute a real server action.
//  3. If it still fails, a clear human message is thrown instead of the raw
//     TypeError "Failed to fetch".
//
// Escape hatch: a NON-localhost NEXT_PUBLIC_API_URL (set at build time) still
// wins, for exotic split-host setups that must call the API directly. A
// localhost value is deliberately ignored.
function resolveApi(): string {
  const env = process.env.NEXT_PUBLIC_API_URL;
  if (env && !/^https?:\/\/(localhost|127\.0\.0\.1)([:/]|$)/.test(env)) return env.replace(/\/$/, '');
  return '/api';
}
const API = resolveApi();

// ── transport errors, in words a user can act on ────────────────────────────
const OFFLINE_MSG = "You're offline — check your internet connection and try again.";
const UNREACHABLE_MSG = "Can't reach the Earnora server right now. Please try again in a moment.";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('earnora.access');
}

export function getRefreshToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('earnora.refresh');
}

export function setSession(accessToken: string, refreshToken: string): void {
  localStorage.setItem('earnora.access', accessToken);
  localStorage.setItem('earnora.refresh', refreshToken);
}

export function clearSession(): void {
  localStorage.removeItem('earnora.access');
  localStorage.removeItem('earnora.refresh');
}

// ── transport ───────────────────────────────────────────────────────────────

type AttemptOpts = { timeoutMs: number; delays: number[] };

// ~9s total retry window: rides out a `nest --watch` recompile or a crash
// restart without leaving a button spinning forever.
const DEFAULT_ATTEMPTS: AttemptOpts = { timeoutMs: 6000, delays: [600, 1200, 2400, 4800] };
// Uploads get a longer leash (4MB over a slow phone connection) but fewer tries.
const UPLOAD_ATTEMPTS: AttemptOpts = { timeoutMs: 25000, delays: [800, 1600] };

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function offline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

/** Error pages from the Next proxy are HTML or plain text; every response the
 *  API itself produces (including errors) is JSON. This tells them apart. */
function looksLikeJson(text: string): boolean {
  const t = text.trimStart();
  return t.startsWith('{') || t.startsWith('[');
}

function parseBody(text: string): any {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** The server's message when there is one, or a friendly fallback when the
 *  body is an HTML error page from the proxy (API briefly down). */
function httpError(status: number, data: any, text: string): string {
  if (typeof data === 'object' && data !== null) {
    return Array.isArray(data.message) ? data.message.join(', ') : data.message || data.error || '';
  }
  if (status >= 500) return UNREACHABLE_MSG;
  return text;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** fetch + bounded retry. Retries ONLY failures where the request cannot have
 *  reached the API — connection refused, timeout, or a 5xx with a non-JSON
 *  body (that is how the Next proxy reports "the API process is down"). A real
 *  API response, JSON error included, is returned immediately so rate limits,
 *  validation and 401-refresh behave exactly as before. */
async function request(
  url: string,
  init: RequestInit,
  opts: AttemptOpts = DEFAULT_ATTEMPTS,
): Promise<{ res: Response; text: string }> {
  if (offline()) throw new ApiError(0, OFFLINE_MSG);
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    let text: string;
    try {
      res = await fetchWithTimeout(url, init, opts.timeoutMs);
      text = await res.text();
    } catch {
      // connection refused / timed out / dropped before a byte arrived
      if (offline() || attempt >= opts.delays.length) throw new ApiError(0, UNREACHABLE_MSG);
      await sleep(opts.delays[attempt]);
      continue;
    }
    // Proxy says upstream is down (non-JSON 5xx): the request never reached the
    // API, so retrying is safe. On the last try, hand the response back and let
    // the caller surface a friendly message.
    if (res.status >= 500 && !looksLikeJson(text) && attempt < opts.delays.length) {
      await sleep(opts.delays[attempt]);
      continue;
    }
    return { res, text };
  }
}

// ── calls ───────────────────────────────────────────────────────────────────

export async function api<T = any>(
  path: string,
  opts: { method?: string; body?: unknown; auth?: boolean; headers?: Record<string, string> } = {},
  depth = 0, // bounds the 401 → refresh → retry chain to one round
): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json', ...(opts.headers ?? {}) };
  const token = getToken();
  if ((opts.auth !== false) && token) headers['authorization'] = `Bearer ${token}`;

  const { res, text } = await request(`${API}${path}`, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  if (res.status === 401 && opts.auth !== false) {
    const refreshed = depth < 1 ? await tryRefresh() : 'denied';
    if (refreshed === 'ok') return api<T>(path, opts, depth + 1);
    // Server unreachable while refreshing: keep the session, report the outage —
    // a network blip must never log the user out.
    if (refreshed === 'unreachable') throw new ApiError(0, UNREACHABLE_MSG);
    clearSession();
    if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
      window.location.href = '/login';
    }
  }

  const data = parseBody(text);
  if (!res.ok) {
    const msg = httpError(res.status, data, text);
    throw new ApiError(res.status, msg || `Request failed (${res.status})`);
  }
  return data as T;
}

/** Multipart upload (screenshot proof). Never sets content-type - the browser
 *  must add the multipart boundary itself. */
export async function apiUpload<T = any>(path: string, file: File): Promise<T> {
  const fd = new FormData();
  fd.append('file', file);

  const send = () => {
    const headers: Record<string, string> = {};
    const t = getToken();
    if (t) headers['authorization'] = `Bearer ${t}`;
    return request(`${API}${path}`, { method: 'POST', headers, body: fd }, UPLOAD_ATTEMPTS);
  };

  let { res, text } = await send();
  if (res.status === 401) {
    const refreshed = await tryRefresh();
    if (refreshed === 'ok') {
      ({ res, text } = await send());
    } else if (refreshed === 'unreachable') {
      throw new ApiError(0, UNREACHABLE_MSG);
    } else {
      clearSession();
      if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
        window.location.href = '/login';
      }
    }
  }

  const data = parseBody(text);
  if (!res.ok) {
    const msg = httpError(res.status, data, text);
    throw new ApiError(res.status, msg || `Upload failed (${res.status})`);
  }
  return data as T;
}

type RefreshResult = 'ok' | 'denied' | 'unreachable';

async function tryRefresh(): Promise<RefreshResult> {
  const refresh = getRefreshToken();
  if (!refresh) return 'denied';
  try {
    const { res, text } = await request(
      `${API}/auth/refresh`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken: refresh }),
      },
      { timeoutMs: 6000, delays: [400, 800] },
    );
    // Proxy says the API process is down (HTML/text 5xx after retries): the
    // server never got to evaluate this token — an outage must never be
    // mistaken for a revoked session, or a blip would log everyone out.
    if (res.status >= 500 && !looksLikeJson(text)) return 'unreachable';
    if (!res.ok) return 'denied';
    const data = parseBody(text);
    if (!data || !data.accessToken || !data.refreshToken) return 'denied';
    setSession(data.accessToken, data.refreshToken);
    return 'ok';
  } catch (e) {
    return e instanceof ApiError && e.status === 0 ? 'unreachable' : 'denied';
  }
}

// ── formatting helpers ───────────────────────────────────────────────────────

export function naira(kobo: number | string | null | undefined): string {
  const n = Number(kobo ?? 0) / 100;
  return `₦${n.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function shortDate(v: string | null | undefined): string {
  if (!v) return '—';
  const d = new Date(v);
  return d.toLocaleString('en-NG', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export const API_BASE = API;
