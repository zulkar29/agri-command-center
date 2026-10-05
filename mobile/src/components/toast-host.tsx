import { Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useAtomValue } from 'jotai'
import { F } from '@/lib/fonts'
import { C, R, tone } from '@/lib/theme'
import type { Tone } from '@/lib/types'
import { toastsAtom, type ToastKind } from '@/state/toast'

const KIND: Record<ToastKind, { t: Tone; icon: keyof typeof Ionicons.glyphMap }> = {
  success: { t: 'ok', icon: 'checkmark-circle' },
  error: { t: 'bad', icon: 'alert-circle' },
  warning: { t: 'warn', icon: 'warning' },
  info: { t: 'info', icon: 'information-circle' },
}

/** Top-of-screen toast overlay — the mobile stand-in for sonner. */
export function ToastHost() {
  const toasts = useAtomValue(toastsAtom)
  if (toasts.length === 0) return null
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', top: 0, left: 0, right: 0 }}>
      <SafeAreaView edges={['top']}>
        <View style={{ paddingHorizontal: 16, paddingTop: 6, gap: 6, alignItems: 'center' }}>
          {toasts.map((t) => {
            const k = KIND[t.kind]
            const c = tone[k.t]
            return (
              <View
                key={t.id}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 8,
                  maxWidth: '94%',
                  backgroundColor: C.card,
                  borderWidth: 1,
                  borderColor: c.line,
                  borderRadius: R.md,
                  paddingVertical: 8,
                  paddingHorizontal: 12,
                  shadowColor: '#1a241d',
                  shadowOpacity: 0.1,
                  shadowRadius: 8,
                  shadowOffset: { width: 0, height: 2 },
                  elevation: 3,
                }}
              >
                <Ionicons name={k.icon} size={17} color={c.solid} />
                <Text style={{ fontFamily: F.med, fontSize: 13.5, color: c.ink, flexShrink: 1 }}>
                  {t.msg}
                </Text>
              </View>
            )
          })}
        </View>
      </SafeAreaView>
    </View>
  )
}
