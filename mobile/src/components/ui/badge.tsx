import { type ReactNode } from 'react'
import { Text, View } from 'react-native'
import { F } from '@/lib/fonts'
import { C, tone } from '@/lib/theme'
import type { Tone } from '@/lib/types'

export function Badge({ children, t = 'neutral' }: { children: ReactNode; t?: Tone }) {
  const c = tone[t]
  return (
    <View
      style={{
        backgroundColor: c.soft,
        borderWidth: 1,
        borderColor: c.line,
        borderRadius: 999,
        paddingVertical: 2,
        paddingHorizontal: 8,
        alignSelf: 'flex-start',
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <Dot color={c.solid} />
        <Text style={{ fontFamily: F.semi, fontSize: 12, color: c.ink, includeFontPadding: false }}>
          {children}
        </Text>
      </View>
    </View>
  )
}

export function Dot({ color }: { color: string }) {
  return <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }} />
}

/** A bare status dot with no chip, tone → color. */
export const toneDot: Record<Tone, string> = {
  ok: C.ok,
  warn: C.warn,
  bad: C.bad,
  info: C.info,
  neutral: C.neutral,
}
