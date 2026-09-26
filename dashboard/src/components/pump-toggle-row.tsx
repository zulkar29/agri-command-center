import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useFarm } from '@/atoms/farm'

/** Pump state plus a start/stop button. */
export function PumpToggleRow({ disabled }: { disabled?: boolean }) {
  const { t } = useTranslation()
  const pumpOn = useFarm((s) => s.pumpOn)
  const mode = useFarm((s) => s.mode)
  const togglePump = useFarm((s) => s.togglePump)
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <span className={cn('size-4 rounded-full', pumpOn ? 'animate-pulse bg-primary' : 'bg-slate-300')} />
        <div className="flex flex-col">
          <span className="text-xl font-semibold">{pumpOn ? t('farm.pumpRunning') : t('farm.pumpStopped')}</span>
          <span className="text-[13px] text-muted-foreground">
            {mode === 'auto' ? t('farm.autoModeNote') : t('farm.manualModeNote')}
          </span>
        </div>
      </div>
      <Button variant={pumpOn ? 'danger' : 'default'} onClick={togglePump} disabled={disabled} aria-pressed={pumpOn}>
        {pumpOn ? t('farm.pumpOffBtn') : t('farm.pumpOnBtn')}
      </Button>
    </div>
  )
}
