import { Controller, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { useAtomValue } from 'jotai'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardTitle } from '@/components/ui/card'
import { Field, Input } from '@/components/ui/input'
import { AppText } from '@/components/ui/text'
import { toNum } from '@/lib/format'
import { C } from '@/lib/theme'
import { useSetPumpFlow, useWaterSummary } from '@/services/harvest'
import { useSetMaxDaily } from '@/services/safety'
import { authSessionAtom, demoAtom } from '@/state/conn'
import { useFarm } from '@/state/farm'

/**
 * Owner-only pump settings: the measured flow (litres/min, the multiplier for
 * every water figure) and the daily run-time cap that auto mode will not pass.
 */
export function PumpSettingsCard() {
  const { t } = useTranslation()
  const demo = useAtomValue(demoAtom)
  const isOwner = useAtomValue(authSessionAtom)?.user.role === 'মালিক'
  const water = useWaterSummary(30)
  const saveFlow = useSetPumpFlow()
  const maxDaily = useFarm((f) => f.maxDailyMinutes ?? 0)
  const saveMax = useSetMaxDaily()
  // each form prefills from the server value as soon as it arrives
  const flowForm = useForm<{ flow: string }>({ values: { flow: water.data ? String(water.data.pumpFlowLpm) : '' } })
  const limitForm = useForm<{ limit: string }>({ values: { limit: String(maxDaily) } })
  if (demo || !isOwner) return null

  const nonNegative = (v: string) => toNum(v) >= 0
  return (
    <Card style={{ gap: 12 }}>
      <CardTitle>{t('settings.safetyTitle')} · {t('harvest.flowTitle')}</CardTitle>
      <Field label={t('harvest.flowLabel')} hint={t('harvest.flowNote')}>
        <Controller
          control={flowForm.control}
          name="flow"
          rules={{ validate: nonNegative }}
          render={({ field }) => <Input value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} keyboardType="decimal-pad" />}
        />
      </Field>
      <Button busy={saveFlow.isPending} onPress={() => void flowForm.handleSubmit((v) => saveFlow.mutate(toNum(v.flow)))()}>
        {t('harvest.flowSave')}
      </Button>
      <AppText weight="semi" style={{ color: C.muted, fontSize: 13 }}>{t('settings.maxDaily')}</AppText>
      <CardDescription>{t('settings.maxDailyNote')}</CardDescription>
      <Controller
        control={limitForm.control}
        name="limit"
        rules={{ validate: nonNegative }}
        render={({ field }) => <Input value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} keyboardType="number-pad" />}
      />
      <Button
        variant="outline"
        busy={saveMax.isPending}
        onPress={() => void limitForm.handleSubmit((v) => saveMax.mutate(Math.round(toNum(v.limit))))()}
      >
        {t('settings.maxDailySave')}
      </Button>
    </Card>
  )
}
