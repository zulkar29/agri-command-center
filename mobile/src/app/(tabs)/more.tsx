import { Pressable, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { ConnBadge } from '@/components/conn-badge'
import { Screen } from '@/components/screen'
import { AppText } from '@/components/ui/text'
import { useTranslation } from 'react-i18next'
import { C, R } from '@/lib/theme'
import { go } from '@/lib/nav'
import type { ViewId } from '@/lib/types'

const ITEMS: { id: ViewId; labelKey: string; subKey: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { id: 'analytics', labelKey: 'nav.analytics.label', subKey: 'nav.analytics.sub', icon: 'bar-chart-outline' },
  { id: 'finance', labelKey: 'nav.finance.label', subKey: 'nav.finance.sub', icon: 'wallet-outline' },
  { id: 'inventory', labelKey: 'nav.inventory.label', subKey: 'nav.inventory.sub', icon: 'cube-outline' },
  { id: 'devices', labelKey: 'nav.devices.label', subKey: 'nav.devices.sub', icon: 'hardware-chip-outline' },
  { id: 'settings', labelKey: 'nav.settings.label', subKey: 'm.settingsSub', icon: 'settings-outline' },
]

/** আরও: বাকি পাতাগুলোর সূচি। */
export default function MoreScreen() {
  const { t } = useTranslation()
  return (
    <Screen title={t('m.tab.more')} sub={t('m.moreSub')} right={<ConnBadge />}>
      <View style={{ gap: 10 }}>
        {ITEMS.map((it) => (
          <Pressable
            key={it.id}
            onPress={() => go(it.id)}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: 14,
              backgroundColor: pressed ? C.accent : C.card,
              borderWidth: 1,
              borderColor: C.border,
              borderRadius: R.lg,
              padding: 16,
            })}
          >
            <View
              style={{
                width: 42,
                height: 42,
                borderRadius: 12,
                backgroundColor: C.okSoft,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons name={it.icon} size={21} color={C.primary} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <AppText weight="semi" style={{ fontSize: 16 }}>{t(it.labelKey)}</AppText>
              <AppText style={{ fontSize: 12.5, color: C.muted }}>{t(it.subKey)}</AppText>
            </View>
            <Ionicons name="chevron-forward" size={18} color={C.muted} />
          </Pressable>
        ))}
      </View>
    </Screen>
  )
}
