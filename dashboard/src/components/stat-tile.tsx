import type { LucideIcon } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Gauge } from '@/components/gauge'
import { toneChip, type Tone } from '@/lib/tone'
import { cn } from '@/lib/utils'

interface StatTileProps {
  label: string
  value: string
  unit?: string
  note?: string
  /** 0-100, draws a ring gauge beside the value */
  pct?: number
  tone?: Tone
  icon?: LucideIcon
  valueClassName?: string
}

/** One key figure: label, big value, status note, and a ring gauge or icon chip. */
export function StatTile({ label, value, unit, note, pct, tone = 'ok', icon: Icon, valueClassName }: StatTileProps) {
  return (
    <Card className="min-w-0 flex-1 basis-[150px] gap-3 p-3.5 sm:basis-[210px] sm:p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-[13px] font-medium text-muted-foreground">{label}</span>
          <div className="flex items-baseline gap-1">
            <span className={cn('text-[26px] leading-none font-bold sm:text-[32px]', valueClassName)}>{value}</span>
            {unit ? <span className="text-[15px] text-muted-foreground">{unit}</span> : null}
          </div>
        </div>
        {pct !== undefined ? (
          <>
            <Gauge pct={pct} tone={tone} size={40} className="sm:hidden" />
            <Gauge pct={pct} tone={tone} size={52} className="hidden sm:block">
              {Icon ? <Icon className="size-4 text-muted-foreground" /> : null}
            </Gauge>
          </>
        ) : Icon ? (
          <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-xl sm:size-11', toneChip[tone])}>
            <Icon className="size-5" />
          </span>
        ) : null}
      </div>
      {note ? (
        <span className={cn('text-[13px]', tone === 'bad' ? 'font-semibold text-danger-ink' : tone === 'warn' ? 'text-warning-ink' : 'text-muted-foreground')}>
          {note}
        </span>
      ) : null}
    </Card>
  )
}
