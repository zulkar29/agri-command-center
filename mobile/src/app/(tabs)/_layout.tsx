import { Redirect, Tabs } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { F } from '@/lib/fonts'
import { C } from '@/lib/theme'
import { bootedAtom, demoAtom, serverUrlAtom } from '@/state/conn'

const TABS = [
  { name: 'index', key: 'nav.overview.label', icon: 'home-outline' },
  { name: 'irrigation', key: 'nav.irrigation.label', icon: 'water-outline' },
  { name: 'fields', key: 'm.tab.fields', icon: 'leaf-outline' },
  { name: 'tasks', key: 'nav.tasks.label', icon: 'checkmark-done-outline' },
  { name: 'more', key: 'm.tab.more', icon: 'grid-outline' },
] as const

export default function TabsLayout() {
  const { t } = useTranslation()
  const booted = useAtomValue(bootedAtom)
  const serverUrl = useAtomValue(serverUrlAtom)
  const demo = useAtomValue(demoAtom)

  // Until AsyncStorage answers, keep the splash instead of bouncing routes.
  if (!booted) return null
  if (!serverUrl && !demo) return <Redirect href="/connect" />

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: C.primary,
        tabBarInactiveTintColor: C.muted,
        tabBarStyle: {
          borderTopColor: C.border,
          backgroundColor: C.card,
        },
        tabBarLabelStyle: { fontFamily: F.med, fontSize: 11 },
      }}
    >
      {TABS.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            title: t(tab.key),
            tabBarIcon: ({ color, size }) => (
              <Ionicons name={tab.icon as keyof typeof Ionicons.glyphMap} size={size - 2} color={color} />
            ),
          }}
        />
      ))}
    </Tabs>
  )
}
