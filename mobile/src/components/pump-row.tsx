import { View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { bn } from '@/lib/format'
import { C } from '@/lib/theme'
import { useFarm } from '@/state/farm'
import { AppSwitch } from './ui/switch'
import { AppText } from './ui/text'

/** Pump on/off row with the mode chip, reused on overview + irrigation. */
export function PumpToggleRow({ disabled }: { disabled?: boolean }) {
  const { t } = useTranslation()
  const pumpOn = useFarm((s) => s.pumpOn)
  const mode = useFarm((s) => s.mode)
  const threshold = useFarm((s) => s.threshold)
  const togglePump = useFarm((s) => s.togglePump)

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        borderTopWidth: 1,
        borderTopColor: C.border,
        paddingVertical: 10,
      }}
    >
      <View style={{ gap: 2 }}>
        <AppText weight="semi">{pumpOn ? t('farm.pumpRunning') : t('farm.pumpStopped')}</AppText>
        <AppText style={{ fontSize: 12.5, color: C.muted }}>
          {mode === 'auto' ? `${t('irrigation.auto')} · ${t('analytics.thresholdMark')} ${bn(threshold)}%` : t('irrigation.manual')}
        </AppText>
      </View>
      <AppSwitch value={pumpOn} onValueChange={togglePump} disabled={disabled} />
    </View>
  )
}
