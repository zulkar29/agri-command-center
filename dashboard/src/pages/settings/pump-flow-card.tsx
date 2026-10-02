import { ShieldAlert } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Card, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toNum } from '@/lib/format'
import { useFarm } from '@/atoms/farm'
import { useSetPumpFlow, useWaterSummary } from '@/services/harvest'
import { useSetMaxDaily } from '@/services/safety'

/**
 * Owner-only pump settings: the measured flow (litres/min, the multiplier for
 * every water figure) and the daily run-time cap that auto mode will not pass.
 * Two small forms; each prefills from the server value as soon as it arrives.
 */
export function PumpFlowCard() {
  const { t } = useTranslation()
  const simulate = useFarm((s) => s.simulate)
  const water = useWaterSummary(30)
  const save = useSetPumpFlow()
  const maxDaily = useFarm((f) => f.maxDailyMinutes ?? 0)
  const saveMax = useSetMaxDaily()

  const flowForm = useForm<{ flow: string }>({ values: { flow: water.data ? String(water.data.pumpFlowLpm) : '' } })
  const limitForm = useForm<{ limit: string }>({ values: { limit: String(maxDaily) } })
  if (simulate) return null

  const nonNegative = (v: string) => toNum(v) >= 0
  return (
    <Card>
      <CardTitle icon={ShieldAlert}>{t('settings.safetyTitle')} · {t('harvest.flowTitle')}</CardTitle>
      <form className="flex flex-col gap-1.5" noValidate onSubmit={flowForm.handleSubmit((v) => save.mutate(toNum(v.flow)))}>
        <Label htmlFor="pump-flow">{t('harvest.flowLabel')}</Label>
        <Input id="pump-flow" inputMode="decimal" aria-invalid={!!flowForm.formState.errors.flow} {...flowForm.register('flow', { validate: nonNegative })} />
        <p className="text-[13px] text-muted-foreground">{t('harvest.flowNote')}</p>
        <div>
          <Button type="submit" disabled={save.isPending}>
            {t('harvest.flowSave')}
          </Button>
        </div>
      </form>
      <form
        className="flex flex-col gap-1.5 border-t pt-3"
        noValidate
        onSubmit={limitForm.handleSubmit((v) => saveMax.mutate(Math.round(toNum(v.limit))))}
      >
        <Label htmlFor="max-daily">{t('settings.maxDaily')}</Label>
        <Input id="max-daily" inputMode="numeric" aria-invalid={!!limitForm.formState.errors.limit} {...limitForm.register('limit', { validate: nonNegative })} />
        <p className="text-[13px] text-muted-foreground">{t('settings.maxDailyNote')}</p>
        <div>
          <Button type="submit" variant="outline" disabled={saveMax.isPending}>
            {t('settings.maxDailySave')}
          </Button>
        </div>
      </form>
    </Card>
  )
}
