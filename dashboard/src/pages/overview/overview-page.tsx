import { useMemo, useState } from 'react'
import {
  Activity,
  BatteryCharging,
  Bell,
  CloudRain,
  Droplets,
  History,
  ListChecks,
  Sprout,
  Thermometer,
  Waves,
  Wind,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { PumpToggleRow } from '@/components/pump-toggle-row'
import { Panel } from '@/components/panel'
import { StatTile } from '@/components/stat-tile'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ZoneBars } from '@/components/zone-bars'
import { FORECAST, ZONES } from '@/data/constants'
import { demoBuckets, demoPumpRuns } from '@/data/demo-series'
import { deriveRecs, mean, riskInfo, type Rec } from '@/lib/farm'
import { bn, whenLabel } from '@/lib/format'
import { assigneeLabel, forecastDayLabel } from '@/lib/labels'
import { toneChip, toneDot } from '@/lib/tone'
import { cn } from '@/lib/utils'
import { useFields } from '@/services/fields'
import { useStock } from '@/services/inventory'
import { useTasks } from '@/services/tasks'
import { SPANS, usePumpRuns, useTelemetryBuckets } from '@/services/analytics'
import { SoilChart } from '@/pages/analytics/charts'
import { deriveAnalytics } from '@/pages/analytics/derive'
import { useFarmAlerts } from '@/services/alerts'
import { useWeather } from '@/services/weather'
import { useCan } from '@/atoms/auth'
import { useFarm } from '@/atoms/farm'
import i18n from '@/i18n'
import { WeeklyCard } from './weekly-card'

export function OverviewPage() {
  const { t } = useTranslation()
  const s = useFarm()
  const can = useCan()
  const tasks = useTasks()
  const stock = useStock()
  const fields = useFields()
  const navigate = useNavigate()
  const th = s.threshold
  // server-evaluated alerts while live, the demo derivation otherwise
  const { items: alertItems, ack } = useFarmAlerts()
  const alerts = alertItems
  // live forecast when the farm has coordinates; the sample otherwise
  const weather = useWeather(s.live)
  const forecastDays =
    s.live && weather.data
      ? weather.data.daily.map((d) => ({
          key: d.date,
          // "YYYY-MM-DD" alone parses as UTC midnight; pin it to local midnight so the weekday is right
          label: new Date(`${d.date}T00:00`).toLocaleDateString(
            i18n.language.startsWith('bn') ? 'bn-BD' : 'en-GB',
            { weekday: 'short' },
          ),
          rain: d.rain,
        }))
      : FORECAST.map((f) => ({ key: f.day, label: forecastDayLabel(f.day), rain: f.rain }))
  const rainTomorrow = forecastDays[1]?.rain ?? FORECAST[1].rain
  // recommendations read tasks/stock/fields — the server's while live, not the demo store's
  const recs = deriveRecs({ ...s, tasks, stock, fields }, rainTomorrow)
  const avg = Math.round(mean(s.moist))
  const tank = Math.round(s.tank)
  const hum = Math.round(s.humidity)
  const risk = riskInfo(hum)
  const rainSkip = s.rules.find((r) => r.id === 'r1')?.on ?? false
  const rainNote = rainSkip
    ? rainTomorrow >= 60
      ? t('overview.rainRuleOnSkip')
      : t('overview.rainRuleOnWait')
    : t('overview.rainRuleOff')
  const todayTasks = tasks.filter((t) => !t.done && t.due === 'আজ')

  // 24-hour moisture with irrigation shaded in: averaged telemetry and pump
  // runs while live, the simulated day in নমুনা মোড — the analytics chart
  const buckets = useTelemetryBuckets('24h', s.live)
  const runs = usePumpRuns(1, s.live)
  const [mountedAt] = useState(() => Date.now())
  const day = useMemo(() => {
    const now = mountedAt
    const rows = s.live ? (buckets.data ?? []) : demoBuckets('24h', th, now)
    return deriveAnalytics(rows, s.live ? (runs.data ?? []) : demoPumpRuns(1, th, now), th, SPANS['24h'].stepHours)
  }, [s.live, buckets.data, runs.data, th, mountedAt])

  const runRec = (r: Rec) => {
    if (!r.action) return
    if (r.action.zone !== undefined) s.waterZones([r.action.zone], ZONES[r.action.zone])
    else if (r.action.view) navigate(`/${r.action.view}`)
  }
  // recommendations that water need irrigation rights; "see it" links don't
  const recLocked = (r: Rec) => r.action?.zone !== undefined && !can('irrigation')

  const hasUrgent = alerts.some((a) => a.tone === 'bad')
  const [now] = useState(() => new Date())
  const today = now.toLocaleDateString(i18n.language.startsWith('bn') ? 'bn-BD' : 'en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })

  return (
    <div className="flex flex-col gap-6">
      <section className="relative overflow-hidden rounded-3xl bg-sidebar p-6 text-white shadow-card sm:p-8">
        <div aria-hidden className="pointer-events-none absolute -top-24 -right-16 size-72 rounded-full bg-gold/15 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-28 left-1/3 size-72 rounded-full bg-emerald-400/10 blur-3xl" />
        <div className="relative flex flex-wrap items-end justify-between gap-6">
          <div className="flex min-w-0 max-w-xl flex-col gap-2">
            <span className="text-sm text-sidebar-foreground/80">{today}</span>
            <h2 className="text-3xl leading-tight font-bold sm:text-4xl">
              {alerts.length === 0 ? t('overview.heroOk') : t('overview.heroWatch', { n: bn(alerts.length), count: alerts.length })}
            </h2>
            <p className="text-[15px] leading-relaxed text-sidebar-foreground/85">
              {t('overview.heroSub', { tasks: bn(todayTasks.length), count: todayTasks.length, rain: bn(Math.round(rainTomorrow)) })}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <HeroChip
              icon={Zap}
              label={s.pumpOn ? t('farm.pumpRunning') : t('farm.pumpStopped')}
              tone={s.pumpOn ? 'ok' : 'neutral'}
              pulse={s.pumpOn}
            />
            <HeroChip icon={CloudRain} label={t('overview.rain', { n: bn(Math.round(rainTomorrow)) })} tone={rainTomorrow >= 60 ? 'info' : 'neutral'} />
            <HeroChip icon={Bell} label={t('shell.alerts', { n: bn(alerts.length) })} tone={hasUrgent ? 'bad' : alerts.length ? 'warn' : 'ok'} />
          </div>
        </div>
      </section>

      <section aria-label={t('overview.statsSection')} className="flex flex-wrap gap-3 sm:gap-4">
        <StatTile
          icon={Sprout}
          label={t('overview.soilAvg')}
          value={bn(avg)}
          unit="%"
          pct={avg}
          tone={avg < th ? 'bad' : avg < th + 8 ? 'warn' : 'ok'}
          note={t('overview.thresholdNote', { n: bn(th) })}
        />
        <StatTile
          icon={Waves}
          label={t('overview.tank')}
          value={bn(tank)}
          unit="%"
          pct={tank}
          tone={tank < 30 ? 'bad' : tank < 50 ? 'warn' : 'ok'}
          note={tank < 30 ? t('overview.tankLowNote') : t('overview.tankSensorNote')}
        />
        <StatTile icon={Thermometer} label={t('overview.airTemp')} value={bn(Math.round(s.temp))} unit={t('units.celsius')} tone="info" note={t('overview.fieldSensorNote')} />
        <StatTile icon={Wind} label={t('overview.airHumidity')} value={bn(hum)} unit="%" pct={hum} tone={risk.tone} note={t('overview.riskNote', { level: risk.level })} />
        <StatTile
          icon={BatteryCharging}
          label={t('overview.battery')}
          value={bn(s.volt.toFixed(1))}
          unit={t('units.volt')}
          pct={((s.volt - 11) / 3.4) * 100}
          tone={s.volt >= 12.2 ? 'ok' : 'warn'}
          note={s.volt >= 12.2 ? t('overview.chargeOk') : t('overview.chargeLow')}
        />
      </section>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          <Panel icon={ListChecks} title={t('overview.summaryTitle')}>
            <div className="flex flex-col">
              {recs.map((r) => (
                <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 border-t py-3 first:border-t-0 first:pt-0 last:pb-0">
                  <div className="flex min-w-0 flex-1 basis-72 items-center gap-3">
                    <span className={cn('size-2.5 shrink-0 rounded-full', toneDot[r.tone])} />
                    <span className="leading-relaxed">{r.text}</span>
                  </div>
                  {r.action ? (
                    <Button variant="outline" size="sm" disabled={recLocked(r)} onClick={() => runRec(r)}>
                      {r.action.label}
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
          </Panel>

          <Panel icon={Activity} tone="info" title={t('overview.moist24hTitle')} description={t('ag.soil.note')}>
            {day.soilAvg.length > 1 ? (
              <SoilChart a={day} spanHours={24} threshold={th} />
            ) : (
              <p className="rounded-lg border border-dashed p-4 text-[13px] text-muted-foreground">{s.live && buckets.isPending ? t('ag.loading') : t('ag.empty')}</p>
            )}
          </Panel>

          <WeeklyCard />

          <div className="grid gap-6 lg:grid-cols-2">
            <Panel
              icon={ListChecks}
              tone="warn"
              title={t('overview.todayTasks')}
              action={
                <Button variant="ghost" size="sm" onClick={() => navigate('/tasks')}>
                  {t('overview.allTasks')}
                </Button>
              }
            >
              {todayTasks.length === 0 ? (
                <p className="text-[13px] text-muted-foreground">{t('overview.noTasksToday')}</p>
              ) : (
                todayTasks.map((k) => (
                  <div key={k.id} className="flex flex-wrap items-center justify-between gap-2 border-t py-3 first:border-t-0 first:pt-0">
                    <span>{k.text}</span>
                    <Badge>{assigneeLabel(k.who)}</Badge>
                  </div>
                ))
              )}
            </Panel>

            <Panel icon={History} tone="neutral" title={t('overview.recentIrrigation')}>
              {s.irrLog.slice(0, 5).map((e) => (
                <div key={e.id} className="flex flex-col gap-0.5 border-t py-3 first:border-t-0 first:pt-0">
                  <span className="text-xs text-muted-foreground">{whenLabel(e.at)}</span>
                  <span>{e.text}</span>
                </div>
              ))}
            </Panel>
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <Panel icon={Droplets} tone="info" title={t('overview.quickControl')}>
            <PumpToggleRow disabled={!can('irrigation')} />
            <div className="flex flex-wrap gap-2">
              <Button disabled={!can('irrigation')} onClick={() => s.waterZones([0, 1, 2], 'সব জোন')}>
                {t('overview.waterNow')}
              </Button>
              <Button variant="outline" disabled={!can('irrigation')} onClick={s.fillTank}>
                {t('overview.fillTank')}
              </Button>
            </div>
          </Panel>

          <Panel icon={Bell} tone={hasUrgent ? 'bad' : alerts.length ? 'warn' : 'ok'} title={t('overview.alertsTitle')}>
            {alerts.length === 0 ? (
              <p className="rounded-lg border border-success-line bg-success-soft p-3.5 text-success-ink">{t('alerts.none')}</p>
            ) : (
              <div className="flex flex-col gap-3">
                {alerts.map((a) => (
                  <div
                    key={a.id}
                    className={cn(
                      'flex flex-col gap-2 rounded-xl border p-3.5',
                      a.tone === 'bad' ? 'border-danger-line bg-danger-soft/60' : 'border-warning-line bg-warning-soft/60',
                    )}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold">{a.title}</span>
                      <Badge tone={a.tone}>{a.tone === 'bad' ? t('alerts.urgent') : t('alerts.watch')}</Badge>
                    </div>
                    <span className="text-[13px] text-muted-foreground">{a.detail}</span>
                    <div>
                      <Button variant="outline" size="sm" disabled={!can('irrigation')} onClick={() => ack(a.id)}>
                        {t('alerts.ack')}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel icon={Sprout} title={t('overview.zoneBarsTitle')} description={t('overview.zoneBarsNote')}>
            <ZoneBars />
          </Panel>

          <Panel icon={CloudRain} tone="info" title={t('overview.forecastTitle')} description={s.live && weather.data ? undefined : t('overview.forecastNote')}>
            <div className="flex items-stretch gap-2">
              {forecastDays.map((f) => (
                <div key={f.key} className="flex min-w-0 flex-1 flex-col items-center gap-2 rounded-xl bg-background px-1 py-3">
                  <span className="text-sm font-semibold">{f.label}</span>
                  <div className="flex h-16 w-3.5 items-end rounded-full bg-border">
                    <div
                      className={cn('w-full rounded-full', f.rain >= 60 ? 'bg-water' : 'bg-water/40')}
                      style={{ height: `${Math.max(8, f.rain)}%` }}
                    />
                  </div>
                  <span className="text-[13px]">{t('overview.rain', { n: bn(Math.round(f.rain)) })}</span>
                </div>
              ))}
            </div>
            <p className="text-[13px] text-muted-foreground">{rainNote}</p>
          </Panel>
        </div>
      </div>
    </div>
  )
}

function HeroChip({ icon: Icon, label, tone, pulse }: { icon: LucideIcon; label: string; tone: 'ok' | 'warn' | 'bad' | 'info' | 'neutral'; pulse?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 py-1.5 pr-3.5 pl-2 text-sm font-medium backdrop-blur">
      <span className={cn('flex size-7 items-center justify-center rounded-full', toneChip[tone], pulse && 'animate-pulse')}>
        <Icon className="size-4" />
      </span>
      {label}
    </span>
  )
}
