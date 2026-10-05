import { type ReactNode } from 'react'
import { View, type ViewStyle } from 'react-native'
import { C, R } from '@/lib/theme'
import { AppText } from './text'

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return (
    <View
      style={{
        backgroundColor: C.card,
        borderRadius: R.lg,
        borderWidth: 1,
        borderColor: C.border,
        padding: 16,
        gap: 10,
        ...style,
      }}
    >
      {children}
    </View>
  )
}

export function CardTitle({ children }: { children: ReactNode }) {
  return <AppText weight="semi" style={{ fontSize: 17 }}>{children}</AppText>
}

export function CardDescription({ children }: { children: ReactNode }) {
  return <AppText style={{ fontSize: 13, color: C.muted, marginTop: -6 }}>{children}</AppText>
}
