import { View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useAtomValue } from 'jotai'
import { Card, CardDescription, CardTitle } from '@/components/ui/card'
import { AppText } from '@/components/ui/text'
import { bn } from '@/lib/format'
import { C } from '@/lib/theme'
import { useEfficiency, useWaterSummary } from '@/services/harvest'
import { demoAtom } from '@/state/conn'

/**
 * পানির হিসাব: litres the pump delivered (pump time × measured flow) and
 * litres per kg harvested per field — the "less water, same yield" number.
 */
export function WaterCard() {
  const { t } = useTranslation()
  const demo = useAtomValue(demoAtom)
  const water = useWaterSummary(30)
  const efficiency = useEfficiency(365)
  if (demo) return null

  const w = water.data
  return (
    <Card>
      <CardTitle>{t('harvest.waterTitle')}</CardTitle>
      <CardDescription>{t('harvest.waterNote')}</CardDescription>
      {w && w.pumpFlowLpm <= 0 ? (
        <AppText style={{ fontSize: 13, color: C.warnInk }}>{t('harvest.flowMissing')}</AppText>
      ) : null}
      {w ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 24 }}>
          <View>
            <AppText style={{ fontSize: 12.5, color: C.muted }}>{t('harvest.last30')}</AppText>
            <AppText weight="bold" style={{ fontSize: 26 }}>
              {bn(Math.round(w.litres))} {t('units.litersShort')}
            </AppText>
          </View>
          <View>
            <AppText style={{ fontSize: 12.5, color: C.muted }}>{t('harvest.runs')}</AppText>
            <AppText weight="bold" style={{ fontSize: 26 }}>
              {bn(w.runs)}
            </AppText>
          </View>
        </View>
      ) : null}
      {(efficiency.data ?? []).map((e) => (
        <View
          key={e.fieldId}
          style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: 6, borderTopWidth: 1, borderTopColor: C.border, paddingTop: 8 }}
        >
          <AppText>
            {e.name} <AppText style={{ color: C.muted }}>· {e.crop}</AppText>
          </AppText>
          <AppText style={{ fontSize: 12.5, color: C.muted }}>
            {e.litresPerKg != null
              ? t('harvest.litresPerKg', { n: bn(Math.round(e.litresPerKg)), kg: bn(Math.round(e.kg)) })
              : t('harvest.noData')}
          </AppText>
        </View>
      ))}
    </Card>
  )
}
