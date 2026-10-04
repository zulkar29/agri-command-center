import { useMutation } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { authSessionAtom, logoutServer, setAuth } from '@/state/conn'
import { toast } from '@/state/toast'
import { API_PREFIX, http, normalizeUrl } from './http'
import type { AuthSession, AuthUser } from '@/lib/types'

/**
 * Auth API — the mobile twin of dashboard/src/services/auth.ts. Login
 * (password or Google) resolves to {user, token, refreshToken}; state/conn.ts
 * persists the session and http.ts attaches/refreshes the access token.
 */
export const authService = {
  login: (email: string, password: string) =>
    http.post<AuthSession>('/auth/login', { email, password }),

  /** Google ID token (from expo-auth-session) → app session. */
  google: (idToken: string) => http.post<AuthSession>('/auth/google', { idToken }),

  /** Exchange the refresh token for a new pair (rotates the old one). */
  refresh: (refreshToken: string) =>
    http.post<AuthSession>('/auth/refresh', { refreshToken }),

  /** Revokes the refresh session; the access token ages out on its own. */
  logout: (refreshToken: string) => http.post<void>('/auth/logout', { refreshToken }),

  me: () => http.get<AuthUser>('/auth/me'),

  /** Own name and alert destinations (SMS number, Telegram chat id); '' clears one. */
  updateProfile: (patch: { name?: string; phone?: string; telegramChat?: string }) =>
    http.patch<AuthUser>('/auth/me', patch),
}

/** Asks the server at a typed (not yet saved) address whether Google login is on; '' when unreachable. */
export async function probeGoogleClientId(url: string): Promise<string> {
  try {
    const res = await fetch(`${normalizeUrl(url)}${API_PREFIX}/auth/config`)
    return res.ok ? ((await res.json()) as { googleClientId: string }).googleClientId : ''
  } catch {
    return ''
  }
}

/** Own contact details; the stored session's user follows the server's answer. */
export function useUpdateProfile(okMsg: string, failMsg: string) {
  const session = useAtomValue(authSessionAtom)
  return useMutation({
    mutationFn: authService.updateProfile,
    onSuccess: (me) => {
      if (session) setAuth({ ...session, user: me })
      toast.success(okMsg)
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : failMsg),
  })
}

/** Revokes the session on the server and clears it locally (the local clear happens even if the call fails). */
export function useLogout() {
  return useMutation({ mutationFn: logoutServer })
}
