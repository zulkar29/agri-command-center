import { getDefaultStore } from 'jotai'
import { toast } from 'sonner'
import { authSessionAtom } from '@/atoms/auth'
import i18n from '@/i18n'
import type { AuthSession } from '@/types'

const BASE_URL = import.meta.env.VITE_API_URL ?? ''

/** API version prefix, the single place to bump (backend: api.APIBase). Services pass paths relative to it. */
export const API_PREFIX = '/api/v1'

export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

/**
 * Typed fetch wrapper that every service in this folder reuses. Sends the
 * access token as a bearer header; when it has expired (401) the refresh
 * token is exchanged for a new pair (single-flight — concurrent 401s share
 * one refresh call) and the request is retried once. If refreshing fails the
 * session is cleared and the app routes back to the login screen.
 */
export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await authorizedFetch(path, init, false)
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

/**
 * The raw response of an authorized GET whose body is read incrementally —
 * the live event stream (services/live.ts). Same token refresh and errors
 * as apiFetch.
 */
export function apiStream(path: string, signal: AbortSignal): Promise<Response> {
  return authorizedFetch(path, { signal, headers: { Accept: 'text/event-stream' } }, false)
}

async function authorizedFetch(path: string, init: RequestInit | undefined, retried: boolean): Promise<Response> {
  const session = getDefaultStore().get(authSessionAtom)
  const res = await fetch(`${BASE_URL}${API_PREFIX}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {}),
      ...init?.headers,
    },
  })

  if (res.status === 401 && session && !retried) {
    if (await refreshSession(session.refreshToken)) {
      return authorizedFetch(path, init, true)
    }
  }

  if (!res.ok) {
    if (res.status === 401 && session) {
      getDefaultStore().set(authSessionAtom, null)
      toast.error(i18n.t('farm.sessionExpired'))
    }
    const body = await res.text().catch(() => '')
    let message = body || res.statusText
    try {
      message = JSON.parse(body).error ?? message
    } catch {
      // body was not JSON — keep the raw text
    }
    throw new ApiError(res.status, message)
  }
  return res
}

// refreshSession exchanges the refresh token for a new token pair. It must
// live here (not in auth.ts) because authService → http would be circular;
// concurrent callers share one in-flight request.
let refreshInFlight: Promise<string | null> | null = null

function refreshSession(refreshToken: string): Promise<string | null> {
  refreshInFlight ??= (async () => {
    try {
      const res = await fetch(`${BASE_URL}${API_PREFIX}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      })
      if (!res.ok) return null
      const session = (await res.json()) as AuthSession
      getDefaultStore().set(authSessionAtom, session)
      return session.token
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
