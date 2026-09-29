import { Droplets, Leaf, Sprout, Wallet } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useAtomValue, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import { Navigate, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { authSessionAtom } from '@/atoms/auth'
import { useFarm } from '@/atoms/farm'
import { queryClient } from '@/lib/query-client'
import { useAuthConfig, useGoogleLogin, useLogin } from '@/services/auth'
import type { AuthSession } from '@/types'

// Minimal typing for Google Identity Services (loaded from accounts.google.com).
interface GsiCredentialResponse {
  credential: string
}
interface GsiNamespace {
  accounts: {
    id: {
      initialize(cfg: { client_id: string; callback: (r: GsiCredentialResponse) => void }): void
      renderButton(el: HTMLElement, opts: { theme: string; size: string; width: number; text: string }): void
    }
  }
}
declare global {
  interface Window {
    google?: GsiNamespace
  }
}

interface LoginForm {
  email: string
  password: string
}

/** The demo owner account the backend seeds on an empty database (dev only — never used in production builds). */
const DEV_EMAIL = 'owner@farm.com'
const DEV_PASSWORD = 'farm123'

/** Loads the GSI script once; resolves undefined if it never loads (offline). */
function loadGsi(): Promise<GsiNamespace | undefined> {
  if (window.google) return Promise.resolve(window.google)
  return new Promise((resolve) => {
    const s = document.createElement('script')
    s.src = 'https://accounts.google.com/gsi/client'
    s.async = true
    s.defer = true
    s.onload = () => resolve(window.google)
    s.onerror = () => resolve(undefined)
    document.head.appendChild(s)
  })
}

/**
 * Shown whenever the app runs against the backend (নমুনা মোড off) without a
 * login session — the route guard in App.tsx sends the user here, login sends
 * them back. নমুনা মোড stays one click away for exploring without a server.
 */
export function LoginPage() {
  const { t } = useTranslation()
  const simulate = useFarm((s) => s.simulate)
  const setSimulate = useFarm((s) => s.setSimulate)
  const session = useAtomValue(authSessionAtom)
  const setSession = useSetAtom(authSessionAtom)
  const navigate = useNavigate()

  // Dev builds prefill the seeded owner login (backend/internal/db/seed.go) so
  // testing is one click. import.meta.env.DEV is false in `npm run build`, so a
  // production bundle never carries these values.
  const { register, handleSubmit, formState } = useForm<LoginForm>({
    defaultValues: { email: import.meta.env.DEV ? DEV_EMAIL : '', password: import.meta.env.DEV ? DEV_PASSWORD : '' },
  })
  const loginMutation = useLogin()
  const googleMutation = useGoogleLogin()
  const [error, setError] = useState('')
  const googleClientId = useAuthConfig().data ?? ''
  const googleBtn = useRef<HTMLDivElement>(null)
  const busy = loginMutation.isPending || googleMutation.isPending

  const finish = async (data: AuthSession) => {
    setSession(data)
    // farm snapshot + lists must come from the server now, not any cache
    await queryClient.invalidateQueries()
    navigate('/overview')
  }

  const onError = (fallback: string) => (err: unknown) => setError(err instanceof Error ? err.message : fallback)
  const login = handleSubmit((v) => {
    if (busy) return
    setError('')
    loginMutation.mutate(v, { onSuccess: finish, onError: onError(t('login.failed')) })
  })

  // GSI keeps the callback it was initialized with, so route it through a ref
  // that always sees this render's busy flag, language and handlers.
  const onGoogleCredential = useRef<(credential: string) => void>(() => {})
  useEffect(() => {
    onGoogleCredential.current = (credential) => {
      if (busy) return
      setError('')
      googleMutation.mutate(credential, { onSuccess: finish, onError: onError(t('login.googleFailed')) })
    }
  })

  // Render the official Google button when enabled; the callback gives a
  // one-time ID token the backend verifies with Google.
  useEffect(() => {
    if (!googleClientId) return undefined
    let cancelled = false
    void loadGsi().then((google) => {
      if (cancelled || !google || !googleBtn.current) return
      google.accounts.id.initialize({
        client_id: googleClientId,
        callback: (resp) => onGoogleCredential.current(resp.credential),
      })
      google.accounts.id.renderButton(googleBtn.current, {
        theme: 'outline',
        size: 'large',
        width: 320,
        text: 'signin_with',
      })
    })
    return () => {
      cancelled = true
    }
  }, [googleClientId])

  // already logged in (or a stale form) — every hook above must still run
  if (session) return <Navigate to="/overview" replace />

  return (
    <div className="grid min-h-svh lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-sidebar p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div aria-hidden className="pointer-events-none absolute -top-32 -right-24 size-96 rounded-full bg-gold/15 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-32 -left-16 size-96 rounded-full bg-emerald-400/10 blur-3xl" />
        <div className="relative flex items-center gap-3">
          <span className="flex size-11 items-center justify-center rounded-xl bg-gold text-sidebar">
            <Leaf className="size-6" strokeWidth={2.4} />
          </span>
          <span className="text-xl font-bold">{t('app.name')}</span>
        </div>
        <div className="relative flex max-w-md flex-col gap-8">
          <h2 className="text-4xl leading-tight font-bold">{t('login.pitchTitle')}</h2>
          <ul className="flex flex-col gap-5">
            {([['Droplets', 'pitch1'], ['Sprout', 'pitch2'], ['Wallet', 'pitch3']] as const).map(([k, key]) => {
              const Icon = { Droplets, Sprout, Wallet }[k]
              return (
                <li key={key} className="flex items-start gap-4">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white/10 text-gold">
                    <Icon className="size-5" />
                  </span>
                  <span className="pt-1.5 leading-relaxed text-sidebar-foreground">{t(`login.${key}`)}</span>
                </li>
              )
            })}
          </ul>
        </div>
        <p className="relative text-sm text-sidebar-muted">{t('app.tagline')}</p>
      </aside>

      <div className="flex items-center justify-center bg-background p-4">
      <div className="flex w-full max-w-sm flex-col gap-5">
        <div className="flex flex-col items-center gap-2 text-center lg:items-start lg:text-left">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-sidebar text-gold lg:hidden">
            <Leaf className="size-7" strokeWidth={2.4} />
          </div>
          <h1 className="text-2xl font-bold">{t('app.name')}</h1>
          <p className="text-[13px] text-muted-foreground">
            {simulate ? t('login.subtitleDemo') : t('login.subtitle')}
          </p>
        </div>

        <Card>
          <CardTitle>{t('login.title')}</CardTitle>
          <CardDescription>{t('login.description')}</CardDescription>
          <form className="flex flex-col gap-4" onSubmit={login} noValidate>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="login-email">{t('login.email')}</Label>
              <Input
                id="login-email"
                type="email"
                placeholder="owner@farm.com"
                autoComplete="email"
                aria-invalid={!!formState.errors.email}
                {...register('email', { required: true, validate: (v) => v.includes('@') })}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="login-password">{t('login.password')}</Label>
              <Input
                id="login-password"
                type="password"
                placeholder="••••••••"
                autoComplete="current-password"
                aria-invalid={!!formState.errors.password}
                {...register('password', { required: true })}
              />
            </div>
            {error ? <p className="text-[13px] font-medium text-destructive">{error}</p> : null}
            <Button type="submit" disabled={busy}>{busy ? t('login.busy') : t('login.submit')}</Button>
          </form>

          {googleClientId ? (
            <>
              <div className="flex items-center gap-3">
                <span className="h-px flex-1 bg-border" />
                <span className="text-xs text-muted-foreground">{t('common.or')}</span>
                <span className="h-px flex-1 bg-border" />
              </div>
              <div className="flex justify-center" ref={googleBtn} />
            </>
          ) : null}

          <p className="text-[13px] leading-relaxed text-muted-foreground">
            {t('login.demoTitle')}
            <br />
            {t('login.demoAccounts')}
          </p>
        </Card>

        <div className="flex items-center gap-3">
          <span className="h-px flex-1 bg-border" />
          <span className="text-xs text-muted-foreground">{t('common.or')}</span>
          <span className="h-px flex-1 bg-border" />
        </div>
        <Button variant="outline" onClick={() => setSimulate(true)}>
          {t('login.demoMode')}
        </Button>
      </div>
      </div>
    </div>
  )
}
