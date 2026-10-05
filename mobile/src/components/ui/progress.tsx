import { View } from 'react-native'
import { R, tone } from '@/lib/theme'
import type { Tone } from '@/lib/types'

export function Progress({ value, t = 'ok' }: { value: number; t?: Tone }) {
  return (
    <View
      style={{
        height: 8,
        borderRadius: 999,
        backgroundColor: '#e8ede7',
        overflow: 'hidden',
      }}
    >
      <View
        style={{
          width: `${Math.max(0, Math.min(100, value))}%`,
          height: '100%',
          borderRadius: R.sm,
          backgroundColor: tone[t].solid,
        }}
      />
    </View>
  )
}
