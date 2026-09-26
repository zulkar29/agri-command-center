import { toneRing, type Tone } from '@/lib/tone'
import { cn } from '@/lib/utils'

interface GaugeProps {
  /** 0-100 */
  pct: number
  tone?: Tone
  size?: number
  className?: string
  children?: React.ReactNode
}

/** A ring gauge; children (an icon or a number) sit in the middle. */
export function Gauge({ pct, tone = 'ok', size = 64, className, children }: GaugeProps) {
  const stroke = 7
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const v = Math.min(100, Math.max(0, pct))
  return (
    <div className={cn('relative shrink-0', className)} style={{ width: size, height: size }} aria-hidden>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-border" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - v / 100)}
          className={cn('transition-[stroke-dashoffset] duration-700', toneRing[tone])}
        />
      </svg>
      {children ? <div className="absolute inset-0 flex items-center justify-center">{children}</div> : null}
    </div>
  )
}
