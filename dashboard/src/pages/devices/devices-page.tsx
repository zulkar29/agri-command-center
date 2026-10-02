import { useEffect, useMemo, useRef, useState } from 'react'
import { Activity, BatteryMedium, CircleCheck, Clock, Cpu, Power, Radio, RadioTower, Server, Smartphone, TriangleAlert, Wifi } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Panel } from '@/components/panel'
import { StatTile } from '@/components/stat-tile'
import { Badge } from '@/components/ui/badge'
import { ageLabel, batteryPct, deviceHealth, deviceIssues, freshness, signalPct, toneOfPct, type DeviceIssue, type Health } from '@/lib/devices'
import { mean } from '@/lib/farm'
import { bn } from '@/lib/format'
import { toneChip, type Tone } from '@/lib/tone'
import { cn } from '@/lib/utils'
import { useFarm } from '@/atoms/farm'
import { useFarmAlerts } from '@/services/alerts'
import { useDevices, type DeviceStatus } from '@/services/devices'
import { ConnectGuide } from './connect-guide'
import { DeviceDetail } from './device-detail'
import { DeviceList, type DeviceFilter } from './device-list'
import { KIND_ICON } from './device-meta'
import { SystemDiagram, type DiagramNode } from './system-diagram'

/** The sample devices shown in নমুনা মোড — the same three the backend seeds, driven by the simulated readings. */
function demoDevices(volt: number, pumpOn: boolean, now: number): DeviceStatus[] {
  return [
    { id: 'esp32-gw-1', kind: 'gateway', online: true, metrics: { rssi: -61, uptime_h: 312 }, lastSeenAt: now - 20_000 },
    { id: 'esp32-field-1', kind: 'sensor', online: true, metrics: { battery_v: volt, signal: 82 }, lastSeenAt: now - 45_000 },
    { id: 'pump-relay-1', kind: 'relay', online: true, metrics: { state: pumpOn ? 1 : 0, current_a: pumpOn ? 3.2 : 0 }, lastSeenAt: now - 30_000 },
  ]
}

/**
 * Devices page, worked top-down: the health tiles, what needs fixing now, the
 * device list with one device's details (actions, chart, key) beside it, then
 * the system diagram and the guide for adding a board. The selected device
 * lives in ?device= so a link opens straight to it.
 */
export function DevicesPage() {
  const { t } = useTranslation()
  const s = useFarm()
  const alerts = useFarmAlerts()
  const query = useDevices(s.simulate)
  // one ticking clock so "12 s ago" and the health colours stay current
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5_000)
    return () => clearInterval(id)
  }, [])

  const live = !s.simulate
  const serverDown = live && query.isError
  const devices: DeviceStatus[] = useMemo(() => (live ? (query.data ?? []) : demoDevices(s.volt, s.pumpOn, now)), [live, query.data, s.volt, s.pumpOn, now])

  const health = useMemo(() => Object.fromEntries(devices.map((d) => [d.id, deviceHealth(d, now)])) as Record<string, Health>, [devices, now])
  const issues = useMemo(() => Object.fromEntries(devices.map((d) => [d.id, deviceIssues(d, now, s.pumpOn)])) as Record<string, DeviceIssue[]>, [devices, now, s.pumpOn])
  const allIssues = devices.flatMap((d) => issues[d.id]).sort((a, b) => (a.tone === b.tone ? 0 : a.tone === 'bad' ? -1 : 1))

  // selection: ?device=, else the device with the worst problem, else the first
  const [params, setParams] = useSearchParams()
  const selectedId = params.get('device') ?? allIssues[0]?.deviceId ?? devices[0]?.id
  const selected = devices.find((d) => d.id === selectedId)
  const detailRef = useRef<HTMLDivElement>(null)
  const select = (id: string) => {
    setParams((p) => {
      p.set('device', id)
      return p
    }, { replace: true })
    // stacked layout: bring the details into view
    if (!window.matchMedia('(min-width: 1280px)').matches) detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  const [filter, setFilter] = useState<DeviceFilter>('all')
  const [search, setSearch] = useState('')

  const byKind = (k: DeviceStatus['kind']) => devices.find((d) => d.kind === k)
  const sensor = byKind('sensor')
  const gateway = byKind('gateway')
  const relay = byKind('relay')

  const healthy = devices.filter((d) => health[d.id] === 'ok').length
  const latest = devices.reduce((a, d) => Math.max(a, d.lastSeenAt), 0)
  const volt = sensor?.metrics.battery_v ?? (live ? undefined : s.volt)
  const battPct = volt !== undefined ? batteryPct(volt) : undefined
  const sigs = devices.map((d) => signalPct(d.metrics)).filter((x): x is number => x !== null)
  const sigAvg = sigs.length ? Math.round(mean(sigs)) : undefined

  const tone = (p: number | undefined): Tone => (p === undefined ? 'neutral' : toneOfPct(p))
  const freshTone: Tone = latest ? freshness(latest, now) : 'neutral'

  const lbl: Record<Health, string> = { ok: t('devices.online'), warn: t('devices.weak'), bad: t('devices.offline'), idle: t('devices.notConnected') }
  const since = (d?: DeviceStatus) => (d ? t('devices.lastData', { when: ageLabel(d.lastSeenAt, now) }) : t('devices.notSeen'))
  const sStat = deviceHealth(sensor, now)
  const gStat = deviceHealth(gateway, now)
  const rStat = deviceHealth(relay, now)
  const srvState: Health = serverDown ? 'bad' : 'ok'
  const flowing = (a: Health, b: Health) => (a === 'ok' || a === 'warn') && (b === 'ok' || b === 'warn')
  const pick = (d?: DeviceStatus) => (d ? { onSelect: () => select(d.id), selected: d.id === selected?.id } : {})

  const nodes: Record<'sensor' | 'gateway' | 'relay' | 'server' | 'apps', DiagramNode> = {
    sensor: {
      id: 'sensor',
      icon: Radio,
      title: t('devices.node.sensor'),
      role: t('devices.node.sensorRole'),
      state: sStat,
      stateLabel: lbl[sStat],
      lines: sensor
        ? [t('devices.node.soil', { v: bn(Math.round(mean(s.moist))) }), t('devices.node.tank', { v: bn(Math.round(s.tank)) }), since(sensor)]
        : [since(undefined)],
      ...pick(sensor),
    },
    gateway: {
      id: 'gateway',
      icon: RadioTower,
      title: t('devices.node.gateway'),
      role: t('devices.node.gatewayRole'),
      state: gStat,
      stateLabel: lbl[gStat],
      lines: gateway
        ? [gateway.metrics.rssi !== undefined ? t('devices.signalDbm', { n: bn(Math.round(gateway.metrics.rssi)) }) : '', since(gateway)].filter(Boolean)
        : [since(undefined)],
      ...pick(gateway),
    },
    relay: {
      id: 'relay',
      icon: Power,
      title: t('devices.node.relay'),
      role: t('devices.node.relayRole'),
      state: rStat,
      stateLabel: lbl[rStat],
      lines: relay ? [relay.metrics.state === 1 ? t('devices.stateOn') : t('devices.stateOff'), since(relay)] : [since(undefined)],
      ...pick(relay),
    },
    server: {
      id: 'server',
      icon: Server,
      title: t('devices.node.server'),
      role: live ? t('devices.node.serverRole') : t('devices.node.serverDemo'),
      state: srvState,
      stateLabel: serverDown ? t('devices.offline') : live ? t('devices.online') : t('shell.demoData'),
      lines: latest ? [t('devices.node.received', { when: ageLabel(latest, now) })] : [],
    },
    apps: {
      id: 'apps',
      icon: Smartphone,
      title: t('devices.node.apps'),
      role: t('devices.node.appsRole'),
      state: 'ok',
      stateLabel: t('devices.online'),
      lines: [t('devices.node.alertsOpen', { n: bn(alerts.items.length), count: alerts.items.length })],
    },
  }

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(t('devices.copied'))
    } catch {
      toast.error(t('devices.copyFailed'))
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatTile
          label={t('devices.tiles.online')}
          value={`${bn(healthy)}/${bn(devices.length)}`}
          note={devices.length === 0 ? t('devices.tiles.none') : healthy === devices.length ? t('devices.tiles.allOk') : t('devices.tiles.check')}
          pct={devices.length ? (healthy / devices.length) * 100 : 0}
          tone={devices.length === 0 ? 'neutral' : healthy === devices.length ? 'ok' : healthy === 0 ? 'bad' : 'warn'}
          icon={Cpu}
        />
        <StatTile
          label={t('devices.tiles.lastData')}
          value={latest ? ageLabel(latest, now) : '—'}
          note={freshTone === 'ok' ? t('devices.tiles.fresh') : freshTone === 'warn' ? t('devices.tiles.slow') : freshTone === 'bad' ? t('devices.tiles.stale') : undefined}
          tone={freshTone}
          icon={Clock}
          valueClassName="text-[18px] leading-tight sm:text-[20px]"
        />
        <StatTile
          label={t('devices.tiles.battery')}
          value={volt !== undefined ? bn(volt.toFixed(1)) : '—'}
          unit={volt !== undefined ? t('units.volt') : undefined}
          note={battPct !== undefined ? t('devices.tiles.charge', { n: bn(battPct) }) : undefined}
          pct={battPct}
          tone={tone(battPct)}
          icon={BatteryMedium}
        />
        <StatTile
          label={t('devices.tiles.signal')}
          value={sigAvg !== undefined ? `${bn(sigAvg)}%` : '—'}
          note={sigAvg === undefined ? undefined : sigAvg >= 60 ? t('devices.tiles.strong') : sigAvg >= 30 ? t('devices.tiles.fair') : t('devices.tiles.poor')}
          pct={sigAvg}
          tone={tone(sigAvg)}
          icon={Wifi}
        />
      </section>

      {serverDown ? (
        <p className="rounded-lg border border-danger-line bg-danger-soft px-3 py-2 text-[13px] font-semibold text-danger-ink">{t('devices.serverDown')}</p>
      ) : null}

      {devices.length > 0 ? (
        allIssues.length ? (
          <Panel
            title={t('devices.attention.title')}
            description={t('devices.attention.note')}
            icon={TriangleAlert}
            tone={allIssues[0].tone}
            action={<Badge tone={allIssues[0].tone}>{t('devices.attention.count', { n: bn(allIssues.length) })}</Badge>}
          >
            <ul className="grid gap-2 md:grid-cols-2">
              {allIssues.map((i) => {
                const d = devices.find((x) => x.id === i.deviceId)!
                const Icon = KIND_ICON[d.kind] ?? Cpu
                return (
                  <li key={`${i.deviceId}-${i.key}`}>
                    <button
                      type="button"
                      onClick={() => {
                        setFilter('all')
                        select(i.deviceId)
                      }}
                      className={cn('flex w-full gap-3 rounded-lg p-3 text-left transition-opacity hover:opacity-85 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none', toneChip[i.tone])}
                    >
                      <Icon className="mt-0.5 size-4 shrink-0" />
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="text-[13.5px] font-bold">
                          {t(`devices.kind.${d.kind}`, { defaultValue: d.kind })} · {t(`devices.issue.${i.key}.problem`, { n: bn(i.n ?? 0) })}
                        </span>
                        <span className="text-[13px]">{t(`devices.issue.${i.key}.fix`)}</span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </Panel>
        ) : (
          <p className="flex items-center gap-2 rounded-lg border border-success-line bg-success-soft px-3 py-2.5 text-[13.5px] font-semibold text-success-ink">
            <CircleCheck className="size-4" />
            {t('devices.attention.allOk')}
          </p>
        )
      ) : null}

      <section className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
        <DeviceList
          devices={devices}
          health={health}
          issues={issues}
          now={now}
          selected={selected?.id}
          onSelect={select}
          filter={filter}
          onFilter={setFilter}
          query={search}
          onQuery={setSearch}
          note={live ? t('devices.liveNote') : t('devices.demoNote')}
          loading={live && query.isPending}
        />
        <div ref={detailRef} className="scroll-mt-4">
          <DeviceDetail d={selected} health={selected ? health[selected.id] : 'idle'} issues={selected ? issues[selected.id] : []} now={now} live={live} onCopy={copy} />
        </div>
      </section>

      <Panel
        title={t('devices.diagramTitle')}
        description={t('devices.diagramNote')}
        icon={Activity}
        tone="info"
        action={
          <span className="flex items-center gap-3 text-[12px] text-muted-foreground max-sm:hidden">
            <span className="flex items-center gap-1.5"><span className="h-0.5 w-5 bg-success" />{t('devices.legend.data')}</span>
            <span className="flex items-center gap-1.5"><span className="h-0.5 w-5 bg-info" />{t('devices.legend.cmd')}</span>
          </span>
        }
      >
        <SystemDiagram
          {...nodes}
          labels={{ telemetry: t('devices.legend.data'), command: t('devices.legend.cmd') }}
          links={{
            sensorGateway: flowing(sStat, gStat),
            gatewayServer: flowing(gStat, srvState),
            serverApps: srvState === 'ok',
            gatewayRelay: flowing(gStat, rStat),
          }}
        />
      </Panel>

      <ConnectGuide slug={s.slug ?? 'my-farm'} onCopy={copy} />
    </div>
  )
}
