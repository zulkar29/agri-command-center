import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, BadgeCheck, CloudSun, Droplets, Gauge, Grid3x3, Info, Lightbulb, Scale, ShieldAlert, Sprout, Sun, Thermometer, Waves, Wind } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ChoiceChips } from '@/components/choice-chips'
import { Panel } from '@/components/panel'
import { StatTile } from '@/components/stat-tile'
import { Badge } from '@/components/ui/badge'
import { ZONES } from '@/data/constants'
import { demoBuckets, demoPumpRuns } from '@/data/demo-series'
import { moistureBands } from '@/lib/agro'
import { bn } from '@/lib/format'
import { zoneLabel } from '@/lib/labels'
import { toneBar, toneChip, toneText, type Tone } from '@/lib/tone'
import { cn } from '@/lib/utils'
import { useFarm } from '@/atoms/farm'
import { SPANS, usePumpRuns, useTelemetryBuckets, type Span } from '@/services/analytics'
import { useEfficiency, useWaterSummary, type FieldEfficiency } from '@/services/harvest'
import type { Field } from '@/types'
import { ClimateChart, DryingHeatmap, EfficiencyChart, SoilChart, TankChart, VpdChart, WaterChart } from './charts'
import { deriveAnalytics, insightsFor, withRecentForecast, type Analytics, type Insight, type ZoneStat } from './derive'

const SPAN_KEY = 'farm-command-analytics-span'

/** নমুনা মোড's water-per-kg rows, from the demo fields. */
function demoEfficiency(fields: Field[]): FieldEfficiency[] {
  return fields.map((f, i) => {
    const kg = 120 + ((i * 37) % 90)
    const litresPerKg = 38 + ((i * 53) % 70)
    return { fieldId: f.id, name: f.name, crop: f.crop, zone: f.zone, litres: kg * litresPerKg, kg, litresPerKg, revenue: 0 }
  })
}

/**
 * বিশ্লেষণ — what the sensors say the farm needs: the headline numbers,
 * what to do now, soil moisture against its agronomic bands with every
 * irrigation shaded in, a per-zone forecast of the next watering, crop
 * comfort (heat, fungal weather, VPD), where the water went and how far the
 * tank will last. Live mode reads averaged telemetry buckets and pump runs;
 * নমুনা মোড draws the same page from a simulated month.
 */
export function AnalyticsPage() {
  const { t } = useTranslation()
  const s = useFarm()
  const live = s.live
  const [span, setSpanState] = useState<Span>(() => {
    try {
      const v = localStorage.getItem(SPAN_KEY)
      return v === '24h' || v === '7d' || v === '30d' ? v : '7d'
    } catch {
      return '7d'
    }
  })
  const setSpan = (v: Span) => {
    setSpanState(v)
    try {
      localStorage.setItem(SPAN_KEY, v)
    } catch {
      // private mode: the choice just isn't remembered
    }
  }
  const cfg = SPANS[span]

  // demo series end "now"; a minute clock keeps them current without churn
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])

  const buckets = useTelemetryBuckets(span, live)
  // forecasts always come from the last 24 h at 15-minute resolution
  const recentBuckets = useTelemetryBuckets('24h', live && span !== '24h')
  const runs = usePumpRuns(cfg.days, live)
  const efficiency = useEfficiency(365)
  const water = useWaterSummary(30)

  const a = useMemo<Analytics | null>(() => {
    const rows = live ? buckets.data : demoBuckets(span, s.threshold, now)
    if (!rows) return null
    const runRows = live ? (runs.data ?? []) : demoPumpRuns(cfg.days, s.threshold, now)
    const full = deriveAnalytics(rows, runRows, s.threshold, cfg.stepHours)
    if (span === '24h') return full
    const recentRows = live ? recentBuckets.data : demoBuckets('24h', s.threshold, now)
    return withRecentForecast(full, recentRows ? deriveAnalytics(recentRows, [], s.threshold, SPANS['24h'].stepHours) : null)
  }, [live, buckets.data, recentBuckets.data, runs.data, span, s.threshold, now, cfg.days, cfg.stepHours])
  const effItems = live ? (efficiency.data ?? []) : demoEfficiency(s.fields)

  const header = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <ChoiceChips
        value={span}
        onChange={setSpan}
        label={t('ag.span.label')}
        options={(['24h', '7d', '30d'] as const).map((v) => ({ value: v, label: t(`ag.span.${v}`) }))}
      />
    </div>
  )

  if (!a || a.soilAvg.length < 2) {
    return (
      <div className="flex flex-col gap-5">
        {header}
        <Panel title={t('ag.soil.title')} icon={Droplets} tone="neutral">
          <p className="rounded-lg border border-dashed p-4 text-[13px] text-muted-foreground">
            {live && buckets.isPending ? t('ag.loading') : live && buckets.isError ? t('ag.failed') : t('ag.empty')}
          </p>
        </Panel>
      </div>
    )
  }

  const { dryBelow, wetAbove } = moistureBands(s.threshold)
  const idealPct = Math.round(a.idealShare * 100)
  const delta = a.soilDelta ?? 0
  const flowMissing = live && water.data !== undefined && water.data.pumpFlowLpm <= 0

  return (
    <div className="flex flex-col gap-5">
      {header}

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-5">
        <StatTile
          icon={Sprout}
          label={t('ag.kpi.soil')}
          value={bn(Math.round(a.soilNow ?? 0))}
          unit="%"
          pct={a.soilNow ?? 0}
          tone={(a.soilNow ?? 0) < s.threshold ? 'bad' : 'ok'}
          note={Math.abs(delta) < 1 ? t('ag.kpi.soilFlat') : delta > 0 ? t('ag.kpi.soilUp', { n: bn(Math.round(delta)) }) : t('ag.kpi.soilDown', { n: bn(Math.round(-delta)) })}
        />
        <StatTile
          icon={BadgeCheck}
          label={t('ag.kpi.ideal')}
          value={`${bn(idealPct)}%`}
          pct={idealPct}
          tone={idealPct >= 80 ? 'ok' : idealPct >= 50 ? 'warn' : 'bad'}
          note={t('ag.kpi.idealNote', { lo: bn(dryBelow), hi: bn(wetAbove) })}
        />
        <StatTile
          icon={AlertTriangle}
          label={t('ag.kpi.stress')}
          value={bn(a.stressHours)}
          unit={t('ag.kpi.hUnit')}
          tone={a.stressHours === 0 ? 'ok' : a.stressHours <= cfg.hours * 0.05 ? 'warn' : 'bad'}
          note={t('ag.kpi.stressNote')}
        />
        <StatTile icon={Droplets} label={t('ag.kpi.water')} value={bn(a.litres.toLocaleString('en-IN'))} unit={t('ag.kpi.lUnit')} tone="info" note={t('ag.kpi.waterNote', { n: bn(a.runs) })} />
        <StatTile
          icon={ShieldAlert}
          label={t('ag.kpi.disease')}
          value={bn(a.fungalHours)}
          unit={t('ag.kpi.hUnit')}
          tone={a.fungalHours === 0 ? 'ok' : a.fungalHours < 6 ? 'warn' : 'bad'}
          note={t('ag.kpi.diseaseNote')}
        />
      </section>

      <Todo items={insightsFor(a)} />

      <section className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Panel title={t('ag.soil.title')} description={t('ag.soil.note')} icon={Droplets} tone="ok">
          <SoilChart a={a} spanHours={cfg.hours} threshold={s.threshold} />
        </Panel>
        <Panel title={t('ag.zone.title')} description={t('ag.zone.note')} icon={Gauge} tone="info">
          <div className="flex flex-col gap-3">
            {a.zones.map((z) => (
              <ZoneCard key={z.index} z={z} threshold={s.threshold} />
            ))}
          </div>
        </Panel>
      </section>

      <Panel title={t('ag.heat.title')} description={t('ag.heat.note')} icon={Grid3x3} tone="warn">
        <DryingHeatmap a={a} threshold={s.threshold} />
      </Panel>

      <section className="grid items-start gap-5 lg:grid-cols-2">
        <Panel
          title={t('ag.climate.title')}
          description={t('ag.climate.note')}
          icon={Thermometer}
          tone="warn"
          action={a.tempMax !== null ? <Badge tone={a.heatHours ? 'warn' : 'neutral'}>{t('ag.climate.range', { max: bn(Math.round(a.tempMax)), min: bn(Math.round(a.tempMin ?? 0)) })}</Badge> : undefined}
        >
          <ClimateChart a={a} spanHours={cfg.hours} />
        </Panel>
        <Panel
          title={t('ag.vpd.title')}
          description={t('ag.vpd.note')}
          icon={Wind}
          tone="info"
          action={a.vpdNow !== null ? <Badge tone={a.vpdNowZone === 'ideal' ? 'ok' : a.vpdNowZone === 'disease' || a.vpdNowZone === 'stress' ? 'bad' : 'warn'}>{t('ag.vpd.now', { n: bn(a.vpdNow.toFixed(2)) })}</Badge> : undefined}
        >
          {a.vpdNowZone ? (
            <p className="-mt-2 text-[13px] text-muted-foreground">
              <span className="font-semibold text-foreground">{t(`ag.vpd.zone.${a.vpdNowZone}`)}</span> · {t('ag.vpd.share', { n: bn(Math.round(a.vpdIdealShare * 100)) })}
            </p>
          ) : null}
          <VpdChart a={a} spanHours={cfg.hours} />
        </Panel>
      </section>

      <section className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Panel title={t('ag.water.title')} description={t('ag.water.note')} icon={Waves} tone="info">
          {flowMissing ? <p className="rounded-lg bg-warning-soft px-3 py-2 text-[13px] text-warning-ink">{t('ag.water.flowMissing')}</p> : null}
          {a.waterByDay.length ? <WaterChart a={a} /> : <p className="rounded-lg border border-dashed p-4 text-[13px] text-muted-foreground">{t('ag.water.none')}</p>}
        </Panel>
        <Panel
          title={t('ag.eff.title')}
          description={t('ag.eff.note')}
          icon={Scale}
          tone="ok"
          action={(() => {
            const best = [...effItems].filter((e) => e.litresPerKg !== null).sort((x, y) => (x.litresPerKg ?? 0) - (y.litresPerKg ?? 0))[0]
            return best ? <Badge tone="ok">{t('ag.eff.best', { name: best.name })}</Badge> : undefined
          })()}
        >
          {effItems.some((e) => e.litresPerKg !== null) ? <EfficiencyChart items={effItems} /> : <p className="rounded-lg border border-dashed p-4 text-[13px] text-muted-foreground">{t('ag.eff.none')}</p>}
        </Panel>
      </section>

      <Panel title={t('ag.tank.title')} description={tankNote(a, t)} icon={CloudSun} tone={a.tankNow !== null && a.tankNow < 30 ? 'bad' : 'info'}>
        {a.tank.length > 1 ? <TankChart a={a} spanHours={cfg.hours} /> : <p className="rounded-lg border border-dashed p-4 text-[13px] text-muted-foreground">{t('ag.tank.noData')}</p>}
      </Panel>
    </div>
  )
}

function tankNote(a: Analytics, t: (k: string, o?: Record<string, unknown>) => string): string {
  if (a.tankNow === null) return t('ag.tank.noData')
  if (a.tankHoursToRefill === 0) return t('ag.tank.low')
  if (a.tankHoursToRefill === null) return t('ag.tank.steady')
  const h = a.tankHoursToRefill
  return h > 48 ? t('ag.tank.etaDays', { n: bn(Math.round(h / 24)) }) : t('ag.tank.eta', { n: bn(Math.max(1, Math.round(h))) })
}

const INSIGHT_ICON = { waterNow: Droplets, waterSoon: Droplets, fungal: ShieldAlert, heat: Sun, offBand: Info, tank: Waves, thirsty: Info, allGood: BadgeCheck } as const

/** The ranked "what to do now" list. */
function Todo({ items }: { items: Insight[] }) {
  const { t } = useTranslation()
  return (
    <Panel title={t('ag.todo.title')} description={t('ag.todo.note')} icon={Lightbulb} tone={items[0]?.tone === 'bad' ? 'bad' : items[0]?.tone === 'warn' ? 'warn' : 'ok'}>
      <ul className="grid gap-2 md:grid-cols-2">
        {items.map((i) => {
          const Icon = INSIGHT_ICON[i.key]
          const tone: Tone = i.tone
          return (
            <li key={`${i.key}-${i.zone ?? ''}`} className={cn('flex items-start gap-3 rounded-lg p-3 text-[13.5px] leading-relaxed', toneChip[tone])}>
              <Icon className="mt-0.5 size-4 shrink-0" />
              <span>{t(`ag.insight.${i.key}`, { zone: i.zone !== undefined ? zoneLabel(ZONES[i.zone] ?? '') : '', n: bn(i.n ?? 0) })}</span>
            </li>
          )
        })}
      </ul>
    </Panel>
  )
}

/** One zone: moisture now, how fast it dries, and when it next needs water. */
function ZoneCard({ z, threshold }: { z: ZoneStat; threshold: number }) {
  const { t } = useTranslation()
  const now = z.now ?? 0
  const h = z.hoursToThreshold
  const tone: Tone = h === 0 ? 'bad' : h !== null && h <= 12 ? 'warn' : 'ok'
  const forecast =
    h === 0 ? t('ag.zone.waterNow') : h === null ? t('ag.zone.noNeed') : h > 48 ? t('ag.zone.inDays', { n: bn(Math.round(h / 24)) }) : t('ag.zone.inHours', { n: bn(Math.max(1, Math.round(h))) })
  const rate = z.ratePerHour === null ? t('ag.zone.unknown') : z.ratePerHour === 0 ? t('ag.zone.notDrying') : t('ag.zone.rate', { n: bn(Math.round(z.ratePerHour * 24)) })
  const ideal = Math.round(z.idealShare * 100)
  return (
    <div className="flex flex-col gap-2.5 rounded-xl border bg-background/60 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="font-bold">{zoneLabel(ZONES[z.index] ?? '')}</span>
        <span className={cn('text-[22px] leading-none font-bold', now < threshold ? 'text-danger-ink' : '')}>{bn(Math.round(now))}%</span>
      </div>
      <div className="relative h-2 overflow-hidden rounded-full bg-muted">
        <span className={cn('absolute inset-y-0 left-0 rounded-full', toneBar[now < threshold ? 'bad' : now < threshold + 8 ? 'warn' : 'ok'])} style={{ width: `${Math.min(100, now)}%` }} />
        <span className="absolute inset-y-0 w-0.5 bg-foreground/60" style={{ left: `${threshold}%` }} aria-hidden />
      </div>
      <p className={cn('text-[13.5px] font-semibold', toneText[tone])}>{forecast}</p>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[12.5px] text-muted-foreground">
        <span>{rate}</span>
        <span>{t('ag.zone.ideal', { n: bn(ideal) })}</span>
        {z.litres > 0 ? <span>{t('ag.zone.litres', { n: bn(z.litres.toLocaleString('en-IN')) })}</span> : null}
      </div>
    </div>
  )
}
