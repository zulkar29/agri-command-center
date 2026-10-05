import { Pressable, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Ionicons } from '@expo/vector-icons'
import { AppText } from './text'
import { C, R } from '@/lib/theme'

/** −/− value −/+ row used for threshold & duration (dashboard's StepperRow). */
export function StepperRow({
  label,
  hint,
  value,
  disabled,
  onDec,
  onInc,
}: {
  label: string
  hint: string
  value: string
  /** locks the stepper (e.g. role permissions) */
  disabled?: boolean
  onDec: () => void
  onInc: () => void
}) {
  const { t } = useTranslation()
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
      <View style={{ flex: 1, gap: 2 }}>
        <AppText weight="semi">{label}</AppText>
        <AppText style={{ fontSize: 12.5, color: C.muted }}>{hint}</AppText>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <StepBtn icon="remove" label={t('inventory.decrease', { name: label })} disabled={disabled} onPress={onDec} />
        <AppText weight="semi" style={{ fontSize: 17, minWidth: 84, textAlign: 'center' }}>
          {value}
        </AppText>
        <StepBtn icon="add" label={t('inventory.increase', { name: label })} disabled={disabled} onPress={onInc} />
      </View>
    </View>
  )
}

function StepBtn({ icon, label, disabled, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      accessibilityLabel={label}
      style={({ pressed }) => ({
        width: 36,
        height: 36,
        borderRadius: R.md,
        borderWidth: 1,
        borderColor: C.input,
        backgroundColor: pressed ? C.accent : C.card,
        opacity: disabled ? 0.5 : 1,
        alignItems: 'center',
        justifyContent: 'center',
      })}
    >
      <Ionicons name={icon} size={18} color={C.ink} />
    </Pressable>
  )
}
