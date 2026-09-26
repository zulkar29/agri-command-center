import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { ZONES } from '@/data/constants'
import { zoneStatus } from '@/lib/farm'
import { bn } from '@/lib/format'
import { zoneLabel } from '@/lib/labels'
import { toneBar } from '@/lib/tone'
import { cn } from '@/lib/utils'
import { useFarm } from '@/atoms/farm'

/** Soil moisture per zone with the irrigation threshold marked. */
export function ZoneBars() {
  const { t } = useTranslation()
  const moist = useFarm((s) => s.moist)
  const th = useFarm((s) => s.threshold)
  return (
    <div className="flex flex-col gap-4">
      {ZONES.map((z, i) => {
        const st = zoneStatus(moist[i], th)
        const v = Math.round(moist[i])
        return (
          <div key={z} className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold">{zoneLabel(z)}</span>
              <div className="flex items-center gap-2">
                <span className="text-xl font-bold">{bn(v)}%</span>
                <Badge tone={st.tone}>{st.label}</Badge>
              </div>
            </div>
            <div
              role="meter"
              aria-label={`${zoneLabel(z)} · ${t('overview.zoneBarsTitle')}`}
              aria-valuenow={v}
              aria-valuemin={0}
              aria-valuemax={100}
              className="relative h-3 rounded-full bg-border"
            >
              <div className={cn('h-full rounded-full transition-all', toneBar[st.tone])} style={{ width: `${v}%` }} />
              <div className="absolute -top-1 -bottom-1 w-0.5 bg-foreground" style={{ left: `${th}%` }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}
