import { View } from 'react-native'
import { C } from '@/lib/theme'
import type { Tone } from '@/lib/types'
import { AppText } from './text'
import { Progress } from './progress'

/** Compact metric tile: label, big Bangla value + unit, bar, note. */
export function StatTile({
  label,
  value,
  unit,
  pct,
  note,
  t,
}: {
  label: string
  value: string
  unit?: string
  pct?: number
  note?: string
  t?: Tone
}) {
  return (
    <View
      style={{
        flexBasis: '48%',
        flexGrow: 1,
        backgroundColor: C.card,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: C.border,
        padding: 14,
        gap: 4,
      }}
    >
      <AppText style={{ fontSize: 12.5, color: C.muted }}>{label}</AppText>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 3 }}>
        <AppText weight="bold" style={{ fontSize: 26, lineHeight: 32 }}>
          {value}
        </AppText>
        {unit ? <AppText weight="semi" style={{ fontSize: 13, color: C.muted }}>{unit}</AppText> : null}
      </View>
      {pct !== undefined ? <Progress value={pct} t={t} /> : null}
      {note ? <AppText style={{ fontSize: 12, color: C.muted }}>{note}</AppText> : null}
    </View>
  )
}
