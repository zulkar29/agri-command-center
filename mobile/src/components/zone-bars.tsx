import { View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { ZONES } from '@/lib/constants'
import { bn } from '@/lib/format'
import { zoneStatus } from '@/lib/farm'
import { C, tone } from '@/lib/theme'
import { AppText } from './ui/text'

/** Per-zone moisture bars with the irrigation-threshold marker. */
export function ZoneBars({ moist, threshold }: { moist: number[]; threshold: number }) {
  const { t } = useTranslation()
  return (
    <View style={{ gap: 10 }}>
      {ZONES.map((z, i) => {
        const st = zoneStatus(moist[i] ?? 0, threshold)
        const v = Math.max(0, Math.min(100, moist[i] ?? 0))
        return (
          <View key={z} style={{ gap: 4 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <AppText weight="semi" style={{ fontSize: 14 }}>{z}</AppText>
              <AppText style={{ fontSize: 13, color: C.muted }}>{t('irrigation.moisture', { n: bn(Math.round(v)) })}</AppText>
            </View>
            <View style={{ height: 10, borderRadius: 999, backgroundColor: '#e8ede7' }}>
              <View
                style={{
                  width: `${v}%`,
                  height: '100%',
                  borderRadius: 999,
                  backgroundColor: tone[st.tone].solid,
                }}
              />
              <View
                style={{
                  position: 'absolute',
                  left: `${Math.max(0, Math.min(100, threshold))}%`,
                  top: -4,
                  width: 2,
                  height: 18,
                  borderRadius: 1,
                  backgroundColor: C.ink,
                }}
              />
            </View>
            <AppText style={{ fontSize: 11, color: C.muted }}>{st.label}</AppText>
          </View>
        )
      })}
      <AppText style={{ fontSize: 12, color: C.muted }}>{t('m.analytics.thresholdN', { n: bn(threshold) })}</AppText>
    </View>
  )
}
