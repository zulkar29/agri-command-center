/**
 * Typed fetch wrapper every service reuses — the mobile twin of
 * dashboard/src/services/http.ts. The base URL points at the farm's Go
 * server; the login session (access + refresh token, set/persisted by
 * state/conn.ts) rides along as a bearer header. When the access token
 * expires (401) the refresh token is exchanged for a new pair
 * (single-flight) and the request retried once.
 */
import i18n from '@/i18n'
import type { AuthSession } from '@/lib/types'

let baseUrl = ''
let session: AuthSession | null = null

export function setBaseUrl(url: string) {
  baseUrl = url
}

/** The current session lives here so every request can read the tokens. */
export function setSession(s: AuthSession | null) {
  session = s
}

// conn.ts registers here so a refreshed session is persisted + mirrored into
// its atoms — importing conn from this file would be circular.
/** API version prefix, the single place to bump (backend: api.APIBase). Services pass paths relative to it. */
export const API_PREFIX = '/api/v1'

type SessionListener = (s: AuthSession) => void
let sessionListener: SessionListener | undefined

export function onSessionUpdate(fn: SessionListener) {
  sessionListener = fn
}

/** Normalize what the user typed: add the scheme, drop trailing slashes and /api. */
export function normalizeUrl(raw: string): string {
  let u = raw.trim()
  if (!/^https?:\/\//i.test(u)) u = `http://${u}`
  u = u.replace(/\/+$/, '')
  if (u.toLowerCase().endsWith('/api')) u = u.slice(0, -4)
  return u
}

export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

/**
 * `prefix` is the base path in front of `path`: the versioned API by default;
 * only the liveness probe lives outside it (`/api/health`, see farmService.health).
 */
export async function apiFetch<T>(path: string, init?: RequestInit, timeoutMs = 10_000, prefix = API_PREFIX): Promise<T> {
  return fetchWithRefresh<T>(path, init, timeoutMs, false, prefix)
}

async function fetchWithRefresh<T>(
  path: string,
  init: RequestInit | undefined,
  timeoutMs: number,
  retried: boolean,
  prefix: string,
): Promise<T> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  let res: Response
  try {
    res = await fetch(`${baseUrl}${prefix}${path}`, {
      ...init,
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {}),
        ...init?.headers,
      },
    })
  } catch (e) {
    throw new ApiError(0, e instanceof Error && e.name === 'AbortError' ? i18n.t('m.conn.timeout') : i18n.t('m.conn.unreachable'))
  } finally {
    clearTimeout(timer)
  }

  if (res.status === 401 && session && !retried) {
    if (await refreshSession(session.refreshToken)) {
      return fetchWithRefresh<T>(path, init, timeoutMs, true, prefix)
    }
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    let message = body || res.statusText
    try {
      message = JSON.parse(body).error ?? message
    } catch {
      // body was not JSON — keep the raw text
    }
    throw new ApiError(res.status, message)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

// refreshSession exchanges the refresh token for a new pair; it must live
// here (not in auth.ts) because authService → http would be circular, and
// concurrent 401s share one in-flight request.
let refreshInFlight: Promise<string | null> | null = null

function refreshSession(refreshToken: string): Promise<string | null> {
  refreshInFlight ??= (async () => {
    try {
      const res = await fetch(`${baseUrl}${API_PREFIX}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      })
      if (!res.ok) return null
      const fresh = (await res.json()) as AuthSession
      session = fresh
      sessionListener?.(fresh)
      return fresh.token
    } catch {
      return null
    }
  })()
  const flight = refreshInFlight
  void flight.then(() => {
    refreshInFlight = null
  })
  return flight
}

export const http = {
  get: <T>(path: string) => apiFetch<T>(path),
  post: <T>(path: string, body: unknown) =>
    apiFetch<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) =>
    apiFetch<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    apiFetch<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T>(path: string) => apiFetch<T>(path, { method: 'DELETE' }),
}
