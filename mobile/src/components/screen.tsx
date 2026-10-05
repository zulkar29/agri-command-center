import { type ReactNode } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Ionicons } from '@expo/vector-icons'
import { SafeAreaView } from 'react-native-safe-area-context'
import { C } from '@/lib/theme'
import { AppText } from './ui/text'

/** Page scaffold: safe-area header (title + sub + optional back/right slot)
 * over a scrollable body — the shell every screen renders inside. */
export function Screen({
  title,
  sub,
  right,
  onBack,
  children,
}: {
  title: string
  sub?: string
  right?: ReactNode
  onBack?: () => void
  children: ReactNode
}) {
  const { t } = useTranslation()
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top']}>
      <View style={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 12, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 }}>
            {onBack ? (
              <Pressable
                onPress={onBack}
                hitSlop={8}
                accessibilityLabel={t('m.back')}
                style={({ pressed }) => ({
                  width: 34,
                  height: 34,
                  borderRadius: 17,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: pressed ? C.accent : 'transparent',
                })}
              >
                <Ionicons name="chevron-back" size={22} color={C.ink} />
              </Pressable>
            ) : null}
            <AppText weight="bold" style={{ fontSize: 22, flexShrink: 1 }}>
              {title}
            </AppText>
          </View>
          {right}
        </View>
        {sub ? <AppText style={{ fontSize: 13, color: C.muted }}>{sub}</AppText> : null}
      </View>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32, gap: 12 }}
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>
    </SafeAreaView>
  )
}
