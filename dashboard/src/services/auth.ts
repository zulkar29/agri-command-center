import { useMutation, useQuery } from '@tanstack/react-query'
import { useAtom } from 'jotai'
import { authSessionAtom } from '@/atoms/auth'
import { queryClient } from '@/lib/query-client'
import { http } from './http'
import type { AuthUser, AuthSession } from '@/types'

/**
 * Auth API (backend: internal/api/auth.go). Login (password or Google)
 * resolves to {user, token, refreshToken}; callers persist the session via
 * authSessionAtom — http.ts attaches the access token and refreshes it
 * transparently when it expires.
 */
export const authService = {
  login: (email: string, password: string) =>
    http.post<AuthSession>('/auth/login', { email, password }),

  /** Google ID token (from the Sign in with Google button) → app session. */
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

/** GET /api/v1/auth/config — whether Google login is enabled (open endpoint). */
export const authConfigService = {
  get: () => http.get<{ googleClientId: string }>('/auth/config'),
}

// --- TanStack Query hooks (components never call authService directly) ---------

/** Email + password login. The caller stores the session (authSessionAtom) and navigates. */
export function useLogin() {
  return useMutation({ mutationFn: (v: { email: string; password: string }) => authService.login(v.email.trim(), v.password) })
}

/** Google ID token → app session. */
export function useGoogleLogin() {
  return useMutation({ mutationFn: (idToken: string) => authService.google(idToken) })
}

/** The Google client id the server has configured ('' = Google login off). */
export function useAuthConfig() {
  return useQuery({
    queryKey: ['auth-config'],
    queryFn: () => authConfigService.get().then((c) => c.googleClientId),
    retry: false,
    staleTime: Infinity,
  })
}

/** Revokes the refresh session, then drops the local session and every cached list — even if the server is unreachable. */
export function useLogout() {
  const [session, setSession] = useAtom(authSessionAtom)
  return useMutation({
    mutationFn: async () => {
      if (session) {
        try {
          await authService.logout(session.refreshToken)
        } catch {
          /* the local session is cleared either way */
        }
      }
    },
    onSettled: () => {
      setSession(null)
      queryClient.clear()
    },
  })
}

/** Own phone / Telegram chat id; keeps the stored session's user in step. */
export function useUpdateProfile() {
  const [session, setSession] = useAtom(authSessionAtom)
  return useMutation({
    mutationFn: authService.updateProfile,
    onSuccess: (me) => {
      if (session) setSession({ ...session, user: me })
    },
  })
}
