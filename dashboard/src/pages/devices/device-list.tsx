import { BatteryMedium, Cpu, Search, Wifi } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ChoiceChips } from '@/components/choice-chips'
import { Panel } from '@/components/panel'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { ageLabel, batteryPct, signalPct, toneOfPct, type DeviceIssue, type Health } from '@/lib/devices'
import { bn } from '@/lib/format'
import { toneText } from '@/lib/tone'
import { cn } from '@/lib/utils'
import type { DeviceStatus } from '@/services/devices'
import { HEALTH_TONE, KIND_ICON } from './device-meta'

export type DeviceFilter = 'all' | 'issues' | DeviceStatus['kind']

interface Props {
  devices: DeviceStatus[]
  health: Record<string, Health>
  issues: Record<string, DeviceIssue[]>
  now: number
  selected: string | undefined
  onSelect: (id: string) => void
  filter: DeviceFilter
  onFilter: (f: DeviceFilter) => void
  query: string
  onQuery: (q: string) => void
  note: string
  loading: boolean
}

/** The farm's devices as selectable rows, with a kind/problem filter and an id search. */
export function DeviceList({ devices, health, issues, now, selected, onSelect, filter, onFilter, query, onQuery, note, loading }: Props) {
  const { t } = useTranslation()
  const problems = devices.filter((d) => issues[d.id]?.length).length
  const q = query.trim().toLowerCase()
  const shown = devices.filter(
    (d) =>
      (filter === 'all' || (filter === 'issues' ? issues[d.id]?.length : d.kind === filter)) && (!q || d.id.toLowerCase().includes(q)),
  )
  const kinds = new Set(devices.map((d) => d.kind))
  const options: { value: DeviceFilter; label: string }[] = [
    { value: 'all', label: `${t('devices.filter.all')} (${bn(devices.length)})` },
    { value: 'issues', label: `${t('devices.filter.issues')} (${bn(problems)})` },
    ...(['sensor', 'relay', 'gateway'] as const).filter((k) => kinds.has(k)).map((k) => ({ value: k, label: t(`devices.filter.${k}`) })),
  ]
  const stateLabel: Record<Health, string> = { ok: t('devices.online'), warn: t('devices.weak'), bad: t('devices.offline'), idle: t('devices.notConnected') }

  return (
    <Panel title={t('devices.listTitle')} description={note} icon={Cpu}>
      <div className="flex flex-col gap-3">
        <ChoiceChips value={filter} onChange={onFilter} options={options} label={t('devices.filter.label')} />
        {devices.length > 6 ? (
          <label className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(e) => onQuery(e.target.value)} placeholder={t('devices.search')} className="pl-9" aria-label={t('devices.search')} />
          </label>
        ) : null}
      </div>

      {loading ? (
        <p className="rounded-lg border border-dashed p-4 text-[13px] text-muted-foreground">{t('common.loading')}</p>
      ) : devices.length === 0 ? (
        <p className="rounded-lg border border-dashed p-4 text-[13px] text-muted-foreground">{t('devices.empty')}</p>
      ) : shown.length === 0 ? (
        <p className="rounded-lg border border-dashed p-4 text-[13px] text-muted-foreground">{t('devices.noMatch')}</p>
      ) : (
        <ul className="flex flex-col gap-2" role="listbox" aria-label={t('devices.listTitle')}>
          {shown.map((d) => {
            const Icon = KIND_ICON[d.kind] ?? Cpu
            const h = health[d.id] ?? 'idle'
            const worst = issues[d.id]?.[0]
            const batt = d.metrics.battery_v !== undefined ? batteryPct(d.metrics.battery_v) : null
            const sig = signalPct(d.metrics)
            const active = d.id === selected
            return (
              <li key={d.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => onSelect(d.id)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-xl border bg-background/60 p-3 text-left transition-colors hover:bg-accent/60 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none',
                    active && 'border-primary bg-accent',
                  )}
                >
                  <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-lg', h === 'idle' ? 'bg-muted text-muted-foreground' : 'bg-accent text-primary')}>
                    <Icon className="size-5" />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-bold">{t(`devices.kind.${d.kind}`, { defaultValue: d.kind })}</span>
                      <span className="truncate font-mono text-[12px] text-muted-foreground max-sm:basis-full">{d.id}</span>
                    </span>
                    <span className={cn('truncate text-[12.5px]', worst ? toneText[worst.tone] : 'text-muted-foreground')}>
                      {worst ? t(`devices.issue.${worst.key}.problem`, { n: bn(worst.n ?? 0) }) : ageLabel(d.lastSeenAt, now)}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-3 text-[12px] text-muted-foreground max-sm:hidden">
                    {batt !== null ? (
                      <span className={cn('flex items-center gap-1', toneText[toneOfPct(batt)])} title={t('devices.tiles.battery')}>
                        <BatteryMedium className="size-3.5" />
                        {bn(batt)}%
                      </span>
                    ) : null}
                    {sig !== null ? (
                      <span className={cn('flex items-center gap-1', toneText[toneOfPct(sig)])} title={t('devices.tiles.signal')}>
                        <Wifi className="size-3.5" />
                        {bn(sig)}%
                      </span>
                    ) : null}
                  </span>
                  <Badge tone={HEALTH_TONE[h]}>{stateLabel[h]}</Badge>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}
