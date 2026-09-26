import type { LucideIcon } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { toneChip, type Tone } from '@/lib/tone'
import { cn } from '@/lib/utils'

interface PanelProps {
  title: string
  description?: string
  icon?: LucideIcon
  tone?: Tone
  /** right side of the header: a button, link or badge */
  action?: React.ReactNode
  className?: string
  children: React.ReactNode
}

/** A card with a consistent header: icon chip, title, optional description and action. */
export function Panel({ title, description, icon: Icon, tone = 'ok', action, className, children }: PanelProps) {
  return (
    <Card className={cn('gap-4', className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {Icon ? (
            <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-lg', toneChip[tone])}>
              <Icon className="size-[18px]" />
            </span>
          ) : null}
          <div className="flex min-w-0 flex-col">
            <h2 className="text-[17px] leading-snug font-bold">{title}</h2>
            {description ? <p className="text-[13px] leading-snug text-muted-foreground">{description}</p> : null}
          </div>
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children}
    </Card>
  )
}
