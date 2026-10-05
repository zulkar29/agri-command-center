import { type ReactNode } from 'react'
import { Text, TextInput, type TextInputProps, View } from 'react-native'
import { F } from '@/lib/fonts'
import { C, R } from '@/lib/theme'

export function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ fontFamily: F.semi, fontSize: 13, color: C.muted }}>{label}</Text>
      {children}
      {hint ? <Text style={{ fontFamily: F.reg, fontSize: 12, color: C.muted }}>{hint}</Text> : null}
    </View>
  )
}

/** Styled text input — accepts Bangla or ASCII digits in numeric modes. */
export function Input(props: TextInputProps) {
  return (
    <TextInput
      placeholderTextColor={C.muted}
      {...props}
      style={[
        {
          backgroundColor: C.card,
          borderWidth: 1,
          borderColor: C.input,
          borderRadius: R.md,
          paddingHorizontal: 12,
          paddingVertical: 8,
          fontSize: 15,
          fontFamily: F.reg,
          color: C.ink,
        },
        props.style,
      ]}
    />
  )
}

/** Bangla validation message shown under a field (react-hook-form errors). */
export function FieldError({ children }: { children: ReactNode }) {
  return <Text style={{ fontFamily: F.reg, fontSize: 12.5, color: C.badInk }}>{children}</Text>
}
