import { type ReactNode } from 'react'
import { ActivityIndicator, Pressable, Text, type ViewStyle } from 'react-native'
import { F } from '@/lib/fonts'
import { C, R } from '@/lib/theme'

type Variant = 'solid' | 'outline' | 'danger' | 'ghost'
type Size = 'md' | 'sm'

const VARIANTS: Record<Variant, { bg: string; border: string; text: string; pressed: string }> = {
  solid: { bg: C.primary, border: C.primary, text: C.onPrimary, pressed: '#1a6a43' },
  outline: { bg: C.card, border: C.input, text: C.ink, pressed: C.accent },
  danger: { bg: C.badSoft, border: C.badLine, text: C.badInk, pressed: '#fbdcd8' },
  ghost: { bg: 'transparent', border: 'transparent', text: C.ink, pressed: C.accent },
}

export function Button({
  children,
  onPress,
  variant = 'solid',
  size = 'md',
  disabled,
  busy,
  style,
}: {
  children: ReactNode
  onPress?: () => void
  variant?: Variant
  size?: Size
  disabled?: boolean
  busy?: boolean
  style?: ViewStyle
}) {
  const v = VARIANTS[variant]
  const small = size === 'sm'
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      hitSlop={4}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        backgroundColor: pressed ? v.pressed : v.bg,
        borderWidth: 1,
        borderColor: v.border,
        borderRadius: R.md,
        paddingVertical: small ? 6 : 10,
        paddingHorizontal: small ? 12 : 16,
        opacity: disabled ? 0.5 : 1,
        ...style,
      })}
    >
      {busy ? <ActivityIndicator size="small" color={v.text} /> : null}
      <Text
        style={{
          fontFamily: small ? F.semi : F.bold,
          color: v.text,
          fontSize: small ? 13 : 15,
          includeFontPadding: false,
        }}
      >
        {children}
      </Text>
    </Pressable>
  )
}
