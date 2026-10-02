import { Bell, FlaskConical, Languages, type LucideIcon, Map, Scale, ScrollText, ShieldCheck, Sprout, UserRound, Users } from 'lucide-react'
import { useAtomValue } from 'jotai'
import { toast } from 'sonner'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { bn, toNum, whenLabel } from '@/lib/format'
import { authSessionAtom, useCan } from '@/atoms/auth'
import i18n, { setLang, type Lang } from '@/i18n'
import { roleLabel } from '@/lib/labels'
import { useFarm } from '@/atoms/farm'
import { useLogout, useUpdateProfile } from '@/services/auth'
import { useFields } from '@/services/fields'
import {
  useAudit,
  useChangePassword,
  useCreateUser,
  useDeleteUser,
  useUpdateUser,
  useUsers,
} from '@/services/admin'
import { cn } from '@/lib/utils'
import type { NotifSettings, Role } from '@/types'
import { PumpFlowCard } from './pump-flow-card'

const CHANNELS: (keyof NotifSettings)[] = ['push', 'sms', 'whatsapp', 'telegram']
const LANGS: { value: Lang; label: string }[] = [
  { value: 'bn', label: 'বাংলা' },
  { value: 'en', label: 'English' },
]

const ROLE_TONE: Record<Role, 'info' | 'ok' | 'neutral'> = { মালিক: 'info', অপারেটর: 'ok', দর্শক: 'neutral' }

type Tab = 'farm' | 'access' | 'alerts' | 'about'
const TABS: { id: Tab; icon: LucideIcon }[] = [
  { id: 'farm', icon: Sprout },
  { id: 'access', icon: ShieldCheck },
  { id: 'alerts', icon: Bell },
  { id: 'about', icon: Scale },
]

const OSS = [
  { labelKey: 'settings.ossSource', valueKey: 'settings.ossSourceValue' },
  { labelKey: 'settings.ossSelfHost', valueKey: 'settings.ossSelfHostValue' },
]

// roadmap items stay Bengali data for now; the translation item itself is done
const ROADMAP = [
  'ESP32 ফার্মওয়্যার ও MQTT ব্রিজ',
  'ছবি তুলে রোগ ও পোকার রেকর্ড',
  'একাধিক ফার্ম একটা অ্যাকাউন্টে',
  'বাংলাদেশের সরকারি বাজারদরের উৎস',
]

export function SettingsPage() {
  const { t } = useTranslation()
  const s = useFarm()
  const session = useAtomValue(authSessionAtom)
  const user = session?.user ?? null
  const logoutMutation = useLogout()
  const can = useCan()
  const isOwner = user?.role === 'মালিক'
  const fields = useFields()
  const area = fields.reduce((a, f) => a + f.area, 0)
  const plants = fields.reduce((a, f) => a + f.plants, 0)
  // location + account administration only exist against a server
  const liveAdmin = !!user && !s.simulate
  const [tab, setTab] = useState<Tab>('farm')

  return (
    <div className="flex flex-col gap-6">
      <div role="tablist" aria-label={t('nav.settings.label')} className="flex w-full flex-wrap gap-1 rounded-xl border bg-card p-1 shadow-card sm:w-fit">
        {TABS.map(({ id, icon: Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={cn(
              'flex h-10 items-center gap-2 rounded-lg px-4 text-[15px] font-semibold transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40',
              tab === id ? 'bg-primary text-primary-foreground' : 'text-foreground/70 hover:bg-muted',
            )}
          >
            <Icon className="size-4" />
            {t(`settings.tabs.${id}`)}
          </button>
        ))}
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-2">
        {tab === 'farm' ? (
          <>
          <div className="flex flex-col gap-6">
        <FarmInfoCard liveAdmin={liveAdmin} isOwner={isOwner} summary={t('app.farmStats', { area: bn(area), plants: bn(plants), fields: bn(fields.length) })} />

        {isOwner ? <PumpFlowCard /> : null}
        <Card>
          <CardTitle icon={Languages}>{t('settings.languageTitle')}</CardTitle>
          <div className="flex flex-wrap gap-2">
            {LANGS.map((l) => (
              <Button
                key={l.value}
                variant={i18n.language === l.value ? 'default' : 'outline'}
                onClick={() => setLang(l.value)}
                aria-pressed={i18n.language === l.value}
              >
                {l.label}
              </Button>
            ))}
          </div>
        </Card>

          </div>
          <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle icon={FlaskConical}>{t('settings.demoModeTitle')}</CardTitle>
            <CardDescription>{t('settings.demoModeNote')}</CardDescription>
          </CardHeader>
          <div className="flex items-center justify-between gap-3">
            <span className="font-semibold">{t('settings.simulation')}</span>
            <Switch checked={s.simulate} onCheckedChange={s.setSimulate} aria-label={t('settings.simulation')} />
          </div>
          <div>
            <Button variant="outline" onClick={s.resetDemo}>
              {t('settings.resetDemo')}
            </Button>
          </div>
        </Card>

          </div>
          </>
        ) : null}
        {tab === 'access' ? (
          <>
          <div className="flex flex-col gap-6">
        <Card>
          <CardTitle icon={UserRound}>{t('settings.account')}</CardTitle>
          {user ? (
            <>
              <div className="flex items-center justify-between gap-3 border-t py-3 first:border-t-0 first:pt-0">
                <span className="font-semibold">{user.name}</span>
                <Badge tone={ROLE_TONE[user.role]}>{roleLabel(user.role)}</Badge>
              </div>
              <p className="text-[13px] text-muted-foreground">{user.email}</p>
              <div>
                <Button variant="outline" onClick={() => logoutMutation.mutate()}>
                  {t('settings.logout')}
                </Button>
              </div>
            </>
          ) : (
            <p className="text-[13px] text-muted-foreground">{t('settings.demoModeAccount')}</p>
          )}
          {liveAdmin ? <ContactCard /> : null}
          {liveAdmin ? <PasswordCard /> : null}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle icon={Users}>{t('settings.teamTitle')}</CardTitle>
            <CardDescription>{t('settings.teamNote')}</CardDescription>
          </CardHeader>
          {s.team.map((m) => (
            <div key={m.id} className="flex items-center justify-between gap-3 border-t py-3 first:border-t-0 first:pt-0">
              <span className="font-semibold">{m.name}</span>
              <Badge tone={ROLE_TONE[m.role]}>{roleLabel(m.role)}</Badge>
            </div>
          ))}
        </Card>

          </div>
          <div className="flex flex-col gap-6">
        {liveAdmin && isOwner ? <UsersCard currentEmail={user.email} /> : null}
        {liveAdmin && isOwner ? <AuditCard /> : null}
          </div>
          </>
        ) : null}
        {tab === 'alerts' ? (
          <>
          <div className="flex flex-col gap-6">
        <Card>
          <CardTitle icon={Bell}>{t('settings.notifTitle')}</CardTitle>
          {CHANNELS.map((c) => (
            <div key={c} className="flex items-center justify-between gap-3 border-t py-3 first:border-t-0 first:pt-0">
              <span>{t(`settings.channels.${c}`)}</span>
              <Switch checked={s.notif[c]} disabled={!can('farmSetup')} onCheckedChange={() => s.toggleNotif(c)} aria-label={t(`settings.channels.${c}`)} />
            </div>
          ))}
          <p className="text-[13px] text-muted-foreground">{t('settings.notifNote')}</p>
        </Card>
          </div>
          </>
        ) : null}
        {tab === 'about' ? (
          <>
          <div className="flex flex-col gap-6">
        <Card>
          <CardTitle icon={Scale}>{t('settings.ossTitle')}</CardTitle>
          {OSS.map((o) => (
            <div key={o.labelKey} className="flex flex-col gap-0.5 border-t py-3 first:border-t-0 first:pt-0">
              <span className="text-[13px] text-muted-foreground">{t(o.labelKey)}</span>
              <span className="leading-relaxed">{t(o.valueKey)}</span>
            </div>
          ))}
        </Card>
          </div>
          <div className="flex flex-col gap-6">
        <Card>
          <CardTitle icon={Map}>{t('settings.roadmapTitle')}</CardTitle>
          {ROADMAP.map((r) => (
            <div key={r} className="flex items-start gap-3 border-t py-3 first:border-t-0 first:pt-0">
              <span className="mt-2 size-2.5 shrink-0 rounded-full bg-info" />
              <span className="leading-relaxed">{r}</span>
            </div>
          ))}
        </Card>
          </div>
          </>
        ) : null}
      </div>
    </div>
  )
}

interface FarmInfoForm {
  farmName: string
  lat: string
  lng: string
}

/** Farm name and location. One form with a Save button; the fields follow the store, so a server update refreshes them. */
function FarmInfoCard({ liveAdmin, isOwner, summary }: { liveAdmin: boolean; isOwner: boolean; summary: string }) {
  const { t } = useTranslation()
  const s = useFarm()
  const can = useCan()
  const { register, handleSubmit } = useForm<FarmInfoForm>({
    values: { farmName: s.farmName, lat: s.lat != null ? String(s.lat) : '', lng: s.lng != null ? String(s.lng) : '' },
  })
  const save = handleSubmit((v) => {
    if (v.farmName.trim() && v.farmName.trim() !== s.farmName) s.setFarmName(v.farmName.trim())
    // toNum also accepts Bangla digits
    const lat = toNum(v.lat)
    const lng = toNum(v.lng)
    if (!Number.isNaN(lat) && lat !== s.lat) s.setLat(lat)
    if (!Number.isNaN(lng) && lng !== s.lng) s.setLng(lng)
  })
  const canEdit = can('farmSetup')

  return (
    <Card>
      <CardTitle icon={Sprout}>{t('settings.farmInfo')}</CardTitle>
      <form className="flex flex-col gap-3" onSubmit={save} noValidate>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="farm-name">{t('settings.farmName')}</Label>
          <Input id="farm-name" disabled={!canEdit} {...register('farmName')} />
        </div>
        <p className="text-[13px] text-muted-foreground">{summary}</p>
        {liveAdmin ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="farm-lat">{t('settings.locationTitle')}</Label>
            <div className="flex gap-2">
              <Input id="farm-lat" inputMode="decimal" placeholder="23.8103" aria-label={t('settings.lat')} disabled={!isOwner} {...register('lat')} />
              <Input inputMode="decimal" placeholder="90.4125" aria-label={t('settings.lng')} disabled={!isOwner} {...register('lng')} />
            </div>
            <p className="text-[13px] text-muted-foreground">{t('settings.locationNote')}</p>
          </div>
        ) : null}
        {canEdit ? (
          <div>
            <Button type="submit" variant="outline">
              {t('common.save')}
            </Button>
          </div>
        ) : null}
      </form>
    </Card>
  )
}

interface ContactForm {
  phone: string
  chat: string
}

/** Where my alerts go: SMS number and Telegram chat id (any role, live mode only). */
function ContactCard() {
  const { t } = useTranslation()
  const user = useAtomValue(authSessionAtom)?.user
  const save = useUpdateProfile()
  const { register, handleSubmit, formState } = useForm<ContactForm>({ defaultValues: { phone: user?.phone ?? '', chat: user?.telegramChat ?? '' } })
  const submit = handleSubmit((v) =>
    save.mutate(
      { phone: v.phone.trim(), telegramChat: v.chat.trim() },
      {
        onSuccess: () => toast.success(t('settings.contactSaved')),
        onError: (e) => toast.error(e instanceof Error ? e.message : t('settings.contactInvalid')),
      },
    ),
  )

  return (
    <form className="flex flex-col gap-1.5 border-t pt-3" onSubmit={submit} noValidate>
      <Label htmlFor="my-phone">{t('settings.contactTitle')}</Label>
      <p className="text-[13px] text-muted-foreground">{t('settings.contactNote')}</p>
      <div className="flex flex-wrap gap-2">
        <Input
          id="my-phone"
          type="tel"
          inputMode="tel"
          className="min-w-[160px] flex-1"
          placeholder={t('settings.phone')}
          aria-label={t('settings.phone')}
          aria-invalid={!!formState.errors.phone}
          {...register('phone', { validate: (v) => v.trim() === '' || /^\+?[0-9]{10,15}$/.test(v.trim()) })}
        />
        <Input className="min-w-[160px] flex-1" placeholder={t('settings.telegramChat')} aria-label={t('settings.telegramChat')} {...register('chat')} />
        <Button type="submit" variant="outline" disabled={save.isPending}>
          {t('settings.contactSave')}
        </Button>
      </div>
      {formState.errors.phone ? <p className="text-[13px] text-destructive">{t('settings.contactInvalid')}</p> : null}
    </form>
  )
}

interface PasswordForm {
  current: string
  next: string
}

/** Change your own password (any role, live mode only). */
function PasswordCard() {
  const { t } = useTranslation()
  const change = useChangePassword()
  const { register, handleSubmit, reset, formState } = useForm<PasswordForm>({ defaultValues: { current: '', next: '' } })
  const submit = handleSubmit((v) => change.mutate(v, { onSuccess: () => reset() }))

  return (
    <form className="flex flex-col gap-1.5 border-t pt-3" onSubmit={submit} noValidate>
      <Label htmlFor="pw-current">{t('settings.passwordTitle')}</Label>
      <div className="flex flex-wrap gap-2">
        <Input
          id="pw-current"
          type="password"
          autoComplete="current-password"
          className="min-w-[140px] flex-1"
          placeholder={t('settings.currentPassword')}
          aria-label={t('settings.currentPassword')}
          aria-invalid={!!formState.errors.current}
          {...register('current', { required: true })}
        />
        <Input
          type="password"
          autoComplete="new-password"
          className="min-w-[140px] flex-1"
          placeholder={t('settings.newPassword')}
          aria-label={t('settings.newPassword')}
          aria-invalid={!!formState.errors.next}
          {...register('next', { minLength: 8, required: true })}
        />
        <Button type="submit" variant="outline" disabled={change.isPending}>
          {t('settings.passwordTitle')}
        </Button>
      </div>
    </form>
  )
}

interface InviteForm {
  name: string
  email: string
  password: string
  role: Role
}

/** Owner: invite accounts, change roles, reset passwords (live mode only). */
function UsersCard({ currentEmail }: { currentEmail: string }) {
  const { t } = useTranslation()
  const users = useUsers(true)
  const create = useCreateUser()
  const update = useUpdateUser()
  const remove = useDeleteUser()
  const { register, handleSubmit, reset, formState } = useForm<InviteForm>({ defaultValues: { name: '', email: '', password: '', role: 'অপারেটর' } })
  const invite = handleSubmit((v) => create.mutate(v, { onSuccess: () => reset({ ...v, name: '', email: '', password: '' }) }))
  const bad = formState.errors
  const roles = ['মালিক', 'অপারেটর', 'দর্শক'] as Role[]

  return (
    <Card>
      <CardHeader>
        <CardTitle icon={ShieldCheck}>{t('settings.usersTitle')}</CardTitle>
        <CardDescription>{t('settings.usersNote')}</CardDescription>
      </CardHeader>
      {(users.data ?? []).map((u) => (
        <div key={u.id} className="flex flex-wrap items-center justify-between gap-2 border-t py-3 first:border-t-0 first:pt-0">
          <div className="flex min-w-0 flex-col">
            <span className="font-semibold">{u.name}</span>
            <span className="text-[13px] text-muted-foreground">{u.email}</span>
          </div>
          <div className="flex items-center gap-2">
            <select
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={u.role}
              disabled={u.email === currentEmail}
              aria-label={t('settings.usersTitle')}
              onChange={(e) => update.mutate({ id: u.id, role: e.target.value as Role })}
            >
              {roles.map((r) => (
                <option key={r} value={r}>
                  {roleLabel(r)}
                </option>
              ))}
            </select>
            {u.email !== currentEmail ? (
              <Button variant="outline" size="sm" onClick={() => remove.mutate(u.id)}>
                {t('common.delete')}
              </Button>
            ) : null}
          </div>
        </div>
      ))}
      <form className="flex flex-col gap-1.5 border-t pt-3" onSubmit={invite} noValidate>
        <Label htmlFor="new-user">{t('settings.addUser')}</Label>
        <div className="flex flex-wrap gap-2">
          <Input id="new-user" className="min-w-[110px] flex-1" placeholder={t('inventory.name')} aria-invalid={!!bad.name} {...register('name', { validate: (v) => v.trim() !== '' })} />
          <Input
            className="min-w-[160px] flex-1"
            type="email"
            placeholder="email@farm.com"
            aria-label={t('login.email')}
            aria-invalid={!!bad.email}
            {...register('email', { validate: (v) => v.includes('@') })}
          />
          <Input
            className="min-w-[110px] flex-1"
            type="password"
            autoComplete="new-password"
            placeholder={t('settings.newPassword')}
            aria-label={t('settings.newPassword')}
            aria-invalid={!!bad.password}
            {...register('password', { minLength: 8, required: true })}
          />
          <select className="h-9 rounded-md border border-input bg-background px-2 text-sm" aria-label={t('settings.usersTitle')} {...register('role')}>
            {roles.map((r) => (
              <option key={r} value={r}>
                {roleLabel(r)}
              </option>
            ))}
          </select>
          <Button type="submit" disabled={create.isPending}>
            {t('settings.addUser')}
          </Button>
        </div>
      </form>
    </Card>
  )
}

/** Owner: the recent audit trail (live mode only). */
function AuditCard() {
  const { t } = useTranslation()
  const audit = useAudit(true)
  const rows = audit.data ?? []

  return (
    <Card>
      <CardHeader>
        <CardTitle icon={ScrollText}>{t('settings.auditTitle')}</CardTitle>
        <CardDescription>{t('settings.auditNote')}</CardDescription>
      </CardHeader>
      {rows.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">
          {audit.isPending ? t('common.loading') : audit.isError ? t('common.loadFailed') : t('settings.auditEmpty')}
        </p>
      ) : (
        rows.map((r) => (
          <div key={r.id} className="flex flex-col gap-0.5 border-t py-2.5 first:border-t-0 first:pt-0">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-[13px]">{r.action}</span>
              <span className="text-xs text-muted-foreground">{whenLabel(r.at)}</span>
            </div>
            <span className="text-[13px] text-muted-foreground">
              {r.user} · {r.detail}
            </span>
          </div>
        ))
      )}
    </Card>
  )
}
