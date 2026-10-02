import { useMemo, useState } from 'react'
import type { EChartsCoreOption } from 'echarts/core'
import { Copy, Cpu, Droplets, Eye, EyeOff, Globe, KeyRound, LineChart, RefreshCw, Thermometer, TriangleAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ChoiceChips } from '@/components/choice-chips'
import { EChart } from '@/components/echart'
import { Panel } from '@/components/panel'
import { PumpToggleRow } from '@/components/pump-toggle-row'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useCan } from '@/atoms/auth'
import { useFarm } from '@/atoms/farm'
import { AGRO, axisTooltip, CHART_LEGEND, lineSeries, percentAxis, timeAxis, unitAxis } from '@/lib/chart-theme'
import { ageLabel, batteryPct, signalPct, toneOfPct, type DeviceIssue, type Health } from '@/lib/devices'
import { mean } from '@/lib/farm'
import { bn, whenLabel } from '@/lib/format'
import { toneBar, toneChip, toneText } from '@/lib/tone'
import { cn } from '@/lib/utils'
import { useDeviceKey, useRotateDeviceKey, type DeviceStatus } from '@/services/devices'
import { SPANS, useTelemetryBuckets, type Span } from '@/services/analytics'
import { HEALTH_TONE, KIND_ICON } from './device-meta'

interface Props {
  d: DeviceStatus | undefined
  health: Health
  issues: DeviceIssue[]
  now: number
  live: boolean
  onCopy: (text: string) => void
}

/** Everything about one device: health, what to fix, its metrics, and the kind-specific tools (chart, pump, key). */
export function DeviceDetail({ d, health, issues, now, live, onCopy }: Props) {
  const { t } = useTranslation()
  const can = useCan()
  if (!d) {
    return (
      <Panel title={t('devices.statusTitle')} icon={Cpu} tone="neutral">
        <p className="rounded-lg border border-dashed p-4 text-[13px] text-muted-foreground">{t('devices.detail.select')}</p>
      </Panel>
    )
  }
  const Icon = KIND_ICON[d.kind] ?? Cpu
  const stateLabel: Record<Health, string> = { ok: t('devices.online'), warn: t('devices.weak'), bad: t('devices.offline'), idle: t('devices.notConnected') }

  return (
    <div className="flex flex-col gap-5">
      <Panel
        title={t(`devices.kind.${d.kind}`, { defaultValue: d.kind })}
        icon={Icon}
        tone={HEALTH_TONE[health]}
        action={<Badge tone={HEALTH_TONE[health]}>{stateLabel[health]}</Badge>}
      >
        <div className="-mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
          <span className="flex items-center gap-1">
            <code className="font-mono text-muted-foreground">{d.id}</code>
            <Button variant="ghost" size="icon" className="size-7" aria-label={t('devices.detail.copyId')} onClick={() => onCopy(d.id)}>
              <Copy className="size-3.5" />
            </Button>
          </span>
          <span className="text-muted-foreground">
            {t('devices.detail.lastSeen')}:{' '}
            <span className="font-semibold text-foreground">
              {d.lastSeenAt ? `${ageLabel(d.lastSeenAt, now)} · ${whenLabel(d.lastSeenAt, now)}` : t('devices.detail.never')}
            </span>
          </span>
        </div>

        {issues.length ? (
          <ul className="flex flex-col gap-2">
            {issues.map((i) => (
              <li key={i.key} className={cn('flex gap-3 rounded-lg p-3', toneChip[i.tone])}>
                <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                <div className="flex flex-col gap-0.5">
                  <span className="text-[13.5px] font-bold">{t(`devices.issue.${i.key}.problem`, { n: bn(i.n ?? 0) })}</span>
                  <span className="text-[13px]">{t(`devices.issue.${i.key}.fix`)}</span>
                </div>
              </li>
            ))}
          </ul>
        ) : null}

        <Metrics m={d.metrics} />
      </Panel>

      {d.kind === 'relay' ? (
        <Panel title={t('devices.detail.pumpTitle')} icon={KIND_ICON.relay} tone="info">
          <PumpToggleRow disabled={!can('devices')} />
          {!can('devices') ? <p className="text-[13px] text-muted-foreground">{t('devices.detail.noPerm')}</p> : null}
        </Panel>
      ) : null}

      {d.kind === 'sensor' ? (
        <>
          <SensorReadings />
          <NodeChart node={d.id} live={live} />
        </>
      ) : null}

      {live && can('farmSetup') ? <DeviceKeyPanel id={d.id} onCopy={onCopy} /> : null}
    </div>
  )
}

function Meter({ pct, text }: { pct: number; text: string }) {
  return (
    <span className="flex flex-1 items-center gap-3">
      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
        <span className={cn('block h-full rounded-full', toneBar[toneOfPct(pct)])} style={{ width: `${pct}%` }} />
      </span>
      <span className={cn('w-20 shrink-0 text-right font-semibold', toneText[toneOfPct(pct)])}>{text}</span>
    </span>
  )
}

/** Every metric the device reports: known ones with a meter or unit, anything else as-is. */
function Metrics({ m }: { m: Record<string, number> }) {
  const { t } = useTranslation()
  const sig = signalPct(m)
  const rows: { key: string; label: string; value: React.ReactNode }[] = []
  if (m.battery_v !== undefined) rows.push({ key: 'battery_v', label: t('devices.metric.battery_v'), value: <Meter pct={batteryPct(m.battery_v)} text={`${bn(m.battery_v.toFixed(1))} V`} /> })
  if (sig !== null) {
    const text = m.signal === undefined && m.rssi !== undefined ? `${bn(Math.round(m.rssi))} dBm` : `${bn(sig)}%`
    rows.push({ key: 'signal', label: t('devices.metric.signal'), value: <Meter pct={sig} text={text} /> })
  }
  if (m.state !== undefined)
    rows.push({ key: 'state', label: t('devices.metric.state'), value: <span className={cn('font-semibold', m.state === 1 && 'text-success-ink')}>{m.state === 1 ? t('devices.stateOn') : t('devices.stateOff')}</span> })
  if (m.current_a !== undefined) rows.push({ key: 'current_a', label: t('devices.metric.current_a'), value: t('devices.current', { n: bn(m.current_a.toFixed(1)) }) })
  if (m.uptime_h !== undefined) rows.push({ key: 'uptime_h', label: t('devices.metric.uptime_h'), value: t('devices.uptime', { n: bn(Math.round(m.uptime_h)) }) })
  const known = new Set(['battery_v', 'signal', 'rssi', 'state', 'current_a', 'uptime_h'])
  for (const [k, v] of Object.entries(m)) if (!known.has(k)) rows.push({ key: k, label: k, value: bn(String(Math.round(v * 100) / 100)) })
  if (!rows.length) return null
  return (
    <dl className="flex flex-col divide-y rounded-lg border">
      {rows.map((r) => (
        <div key={r.key} className="flex items-center gap-3 px-3 py-2.5 text-[13.5px]">
          <dt className="w-24 shrink-0 text-muted-foreground">{r.label}</dt>
          <dd className="flex flex-1 justify-end">{r.value}</dd>
        </div>
      ))}
    </dl>
  )
}

/** The sensor node's latest values, per zone plus tank and air. */
function SensorReadings() {
  const { t } = useTranslation()
  const s = useFarm()
  return (
    <Panel title={t('devices.detail.readings')} description={t('devices.readingsNote')} icon={Droplets} tone="ok">
      <ul className="flex flex-col gap-2.5">
        {s.moist.map((v, i) => (
          <li key={i} className="flex items-center gap-3 text-[13.5px]">
            <span className="w-16 shrink-0">{t('devices.zoneN', { n: bn(i + 1) })}</span>
            <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
              <span className={cn('block h-full rounded-full', toneBar[v < s.threshold ? 'bad' : v < s.threshold + 8 ? 'warn' : 'ok'])} style={{ width: `${Math.min(100, v)}%` }} />
            </span>
            <span className="w-10 shrink-0 text-right font-bold">{bn(Math.round(v))}%</span>
          </li>
        ))}
      </ul>
      <div className="grid grid-cols-3 gap-2 border-t pt-3 text-center">
        {[
          { icon: Droplets, label: t('devices.tank'), v: `${bn(Math.round(s.tank))}%` },
          { icon: Thermometer, label: t('devices.temp'), v: `${bn(Math.round(s.temp))}°` },
          { icon: Globe, label: t('devices.humidity'), v: `${bn(Math.round(s.humidity))}%` },
        ].map((x) => (
          <div key={x.label} className="rounded-lg bg-muted/60 p-2">
            <x.icon className="mx-auto mb-1 size-4 text-muted-foreground" />
            <p className="text-[17px] leading-tight font-bold">{x.v}</p>
            <p className="text-[12px] text-muted-foreground">{x.label}</p>
          </div>
        ))}
      </div>
    </Panel>
  )
}

/** This node's soil average and battery over time (averaged buckets), refreshed by the live stream. */
function NodeChart({ node, live }: { node: string; live: boolean }) {
  const { t } = useTranslation()
  const [span, setSpan] = useState<Span>('24h')
  const hours = SPANS[span].hours
  const q = useTelemetryBuckets(span, live, node)
  const rows = q.data

  const option = useMemo<EChartsCoreOption | null>(() => {
    if (!rows || rows.length < 2) return null
    const soil: [number, number][] = rows.filter((r) => r.soil_moisture.length).map((r) => [Date.parse(r.ts), Math.round(mean(r.soil_moisture) * 10) / 10])
    const batt: [number, number | null][] = rows.map((r) => [Date.parse(r.ts), r.battery_v || null])
    return {
      grid: { left: 44, right: 50, top: 34, bottom: 26 },
      tooltip: axisTooltip(),
      legend: CHART_LEGEND,
      xAxis: timeAxis(hours),
      yAxis: [percentAxis(), unitAxis('V', { splitLine: { show: false } })],
      series: [
        { ...lineSeries(t('devices.detail.chartSoil'), AGRO.soil, soil, { area: true }), tooltip: { valueFormatter: (v: unknown) => `${bn(Number(v))}%` } },
        { ...lineSeries(t('devices.detail.chartBattery'), AGRO.battery, batt, { yAxisIndex: 1, width: 2, dashed: true }), tooltip: { valueFormatter: (v: unknown) => `${bn(Number(v).toFixed(2))} V` } },
      ],
    }
  }, [rows, hours, t])

  return (
    <Panel
      title={t('devices.detail.chartTitle')}
      icon={LineChart}
      tone="info"
      action={live ? <ChoiceChips value={span} onChange={setSpan} label={t('devices.detail.range')} options={(['24h', '7d', '30d'] as const).map((v) => ({ value: v, label: t(`ag.span.${v}`) }))} /> : undefined}
    >
      {!live ? (
        <p className="rounded-lg border border-dashed p-4 text-[13px] text-muted-foreground">{t('devices.detail.chartDemo')}</p>
      ) : q.isPending ? (
        <p className="rounded-lg border border-dashed p-4 text-[13px] text-muted-foreground">{t('common.loading')}</p>
      ) : option ? (
        <EChart option={option} label={t('devices.detail.chartLabel')} height={240} />
      ) : (
        <p className="rounded-lg border border-dashed p-4 text-[13px] text-muted-foreground">{t('devices.detail.chartEmpty')}</p>
      )}
    </Panel>
  )
}

/** Owner-only: show, copy and rotate the key the firmware sends as X-Device-Key. */
function DeviceKeyPanel({ id, onCopy }: { id: string; onCopy: (text: string) => void }) {
  const { t } = useTranslation()
  const [shown, setShown] = useState(false)
  const key = useDeviceKey(id, shown)
  const rotate = useRotateDeviceKey(id)
  const value = key.data?.apiKey

  const onRotate = () => {
    if (window.confirm(t('devices.key.confirm'))) {
      setShown(true)
      rotate.mutate()
    }
  }

  return (
    <Panel
      title={t('devices.key.title')}
      description={t('devices.key.note')}
      icon={KeyRound}
      tone="warn"
      action={
        <Button variant="outline" size="sm" onClick={() => setShown((v) => !v)} aria-expanded={shown}>
          {shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          {shown ? t('devices.key.hide') : t('devices.key.show')}
        </Button>
      }
    >
      {shown ? (
        key.isPending ? (
          <p className="text-[13px] text-muted-foreground">{t('common.loading')}</p>
        ) : key.isError ? (
          <p className="text-[13px] text-danger-ink">{t('devices.key.loadFailed')}</p>
        ) : value ? (
          <div className="flex items-center gap-2 rounded-lg border bg-muted/50 p-2 pl-3">
            <code className="min-w-0 flex-1 truncate font-mono text-[13px]">{value}</code>
            <Button variant="ghost" size="icon" className="size-8 shrink-0" aria-label={t('devices.copy')} onClick={() => onCopy(value)}>
              <Copy className="size-4" />
            </Button>
          </div>
        ) : (
          <p className="text-[13px] text-muted-foreground">{t('devices.key.none')}</p>
        )
      ) : null}
      <div>
        <Button variant="danger" size="sm" onClick={onRotate} disabled={rotate.isPending}>
          <RefreshCw className={cn('size-4', rotate.isPending && 'animate-spin')} />
          {t('devices.key.rotate')}
        </Button>
      </div>
    </Panel>
  )
}
