import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toneDot } from '@/lib/tone'

export type NodeState = 'ok' | 'warn' | 'bad' | 'idle'

export interface DiagramNode {
  id: string
  icon: LucideIcon
  title: string
  /** one-line role, e.g. "reads soil and tank" */
  role: string
  /** live values shown as small lines */
  lines: string[]
  state: NodeState
  stateLabel: string
  /** makes the box a button (opens that device's details) */
  onSelect?: () => void
  selected?: boolean
}

const STATE_DOT: Record<NodeState, string> = { ok: toneDot.ok, warn: toneDot.warn, bad: toneDot.bad, idle: 'bg-border' }
const STATE_RING: Record<NodeState, string> = {
  ok: 'border-success-line',
  warn: 'border-warning-line',
  bad: 'border-danger-line',
  idle: 'border-dashed border-border opacity-70',
}

function Node({ n, className }: { n: DiagramNode; className?: string }) {
  const Icon = n.icon
  const Box = n.onSelect ? 'button' : 'div'
  return (
    <Box
      type={n.onSelect ? 'button' : undefined}
      onClick={n.onSelect}
      aria-pressed={n.onSelect ? !!n.selected : undefined}
      className={cn(
        'flex min-w-0 flex-col gap-2 rounded-xl border-2 bg-card p-3.5 text-left xl:self-stretch',
        STATE_RING[n.state],
        n.onSelect && 'cursor-pointer transition-shadow hover:shadow-md focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none',
        n.selected && 'ring-[3px] ring-primary/40',
        className,
      )}
    >
      <div className="flex items-center gap-3">
        <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-xl', n.state === 'idle' ? 'bg-muted text-muted-foreground' : 'bg-accent text-primary')}>
          <Icon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="leading-tight font-bold">{n.title}</p>
          <p className="text-[12.5px] leading-snug text-muted-foreground">{n.role}</p>
        </div>
        <span className={cn('size-3 shrink-0 rounded-full', STATE_DOT[n.state], n.state === 'ok' && 'animate-pulse')} title={n.stateLabel} />
      </div>
      <ul className="flex flex-col gap-0.5 border-t pt-2 text-[13px] leading-snug">
        <li className="font-semibold">{n.stateLabel}</li>
        {n.lines.map((l) => (
          <li key={l} className="text-muted-foreground">
            {l}
          </li>
        ))}
      </ul>
    </Box>
  )
}

/** A link between two nodes. `active` → dashes move; otherwise a flat broken line. `back` adds a second, reverse (command) lane. */
function Link({ dir, active, back, label, className }: { dir: 'x' | 'y'; active: boolean; back?: boolean; label?: string; className?: string }) {
  const lane = (reverse: boolean, tone: string) => (
    <span
      className={cn(
        dir === 'x' ? 'h-0.5 w-full' : 'h-full w-0.5',
        active ? (dir === 'x' ? 'flow-x' : 'flow-y') : 'bg-border',
        active && reverse && 'flow-rev',
        active && tone,
      )}
    />
  )
  return (
    <div
      className={cn('flex items-center justify-center gap-1', dir === 'x' ? 'flex-col px-1' : 'h-9 flex-row py-0.5', className)}
      aria-hidden
    >
      {label ? <span className="text-[10.5px] font-semibold tracking-wide text-muted-foreground uppercase">{label}</span> : null}
      {lane(false, 'text-success')}
      {back ? lane(true, 'text-info') : null}
    </div>
  )
}

export interface DiagramLinks {
  sensorGateway: boolean
  gatewayServer: boolean
  serverApps: boolean
  gatewayRelay: boolean
}

interface Props {
  sensor: DiagramNode
  gateway: DiagramNode
  relay: DiagramNode
  server: DiagramNode
  apps: DiagramNode
  links: DiagramLinks
  labels: { telemetry: string; command: string }
}

/**
 * Live system diagram: sensor → gateway → server → apps, with the pump relay
 * hanging off the gateway for commands. Node dots show device health; dashes
 * travel only while both ends are alive (green = readings, blue = commands).
 * Stacked below `xl`, a 3-row grid from `xl`.
 */
export function SystemDiagram({ sensor, gateway, relay, server, apps, links, labels }: Props) {
  return (
    <div className="grid gap-0 xl:grid-cols-[1fr_72px_1fr_72px_1fr_72px_1fr] xl:items-center">
      <Node n={sensor} className="xl:col-start-1 xl:row-start-1" />
      <Link dir="y" active={links.sensorGateway} className="xl:hidden" />
      <Link dir="x" active={links.sensorGateway} label={labels.telemetry} className="hidden xl:col-start-2 xl:row-start-1 xl:flex" />

      <Node n={gateway} className="xl:col-start-3 xl:row-start-1" />
      <Link dir="y" active={links.gatewayRelay} back className="max-xl:hidden xl:col-start-3 xl:row-start-2 xl:justify-self-center" />
      <Node n={relay} className="max-xl:order-last max-xl:mt-4 xl:col-start-3 xl:row-start-3" />

      <Link dir="y" active={links.gatewayServer} back className="xl:hidden" />
      <Link dir="x" active={links.gatewayServer} back label={labels.command} className="hidden xl:col-start-4 xl:row-start-1 xl:flex" />

      <Node n={server} className="xl:col-start-5 xl:row-start-1" />
      <Link dir="y" active={links.serverApps} back className="xl:hidden" />
      <Link dir="x" active={links.serverApps} back className="hidden xl:col-start-6 xl:row-start-1 xl:flex" />
      <Node n={apps} className="xl:col-start-7 xl:row-start-1" />
    </div>
  )
}
