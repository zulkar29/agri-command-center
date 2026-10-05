import { Pressable, Text, View } from 'react-native'
import { F } from '@/lib/fonts'
import { C } from '@/lib/theme'

export interface ChipOption<T extends string> {
  value: T
  label: string
}

/** Selectable pill row — the mobile twin of the dashboard's ChoiceChips. */
export function ChoiceChips<T extends string>({
  value,
  onChange,
  options,
  disabled,
}: {
  value: T
  onChange: (v: T) => void
  options: readonly ChipOption<T>[]
  /** locks the choice (e.g. role permissions) */
  disabled?: boolean
}) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, opacity: disabled ? 0.5 : 1 }}>
      {options.map((o) => {
        const active = o.value === value
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            disabled={disabled}
            hitSlop={4}
            style={{
              backgroundColor: active ? C.primary : C.secondary,
              borderRadius: 999,
              paddingVertical: 6,
              paddingHorizontal: 14,
              borderWidth: 1,
              borderColor: active ? C.primary : C.secondary,
            }}
          >
            <Text
              style={{
                fontFamily: active ? F.semi : F.med,
                fontSize: 13.5,
                color: active ? C.onPrimary : C.ink,
                includeFontPadding: false,
              }}
            >
              {o.label}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}
