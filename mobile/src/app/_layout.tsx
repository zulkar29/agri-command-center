import { useEffect } from 'react'
import { Stack } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import { QueryClientProvider } from '@tanstack/react-query'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { ToastHost } from '@/components/toast-host'
import { C } from '@/lib/theme'
import { useAppFonts } from '@/lib/fonts'
import '@/i18n'
import { useFarmEngine } from '@/state/engine'
import { useOutboxFlusher } from '@/state/outbox'
import { queryClient } from '@/services/query-client'

void SplashScreen.preventAutoHideAsync().catch(() => {
  // already hidden (e.g. fast refresh) — nothing to keep up
})

export default function RootLayout() {
  const ready = useAppFonts()
  useFarmEngine()
  useOutboxFlusher() // sends writes that were made offline

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync().catch(() => {})
  }, [ready])

  if (!ready) return null

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: C.bg },
            animation: 'slide_from_right',
          }}
        >
          <Stack.Screen name="connect" />
          <Stack.Screen name="analytics" />
          <Stack.Screen name="finance" />
          <Stack.Screen name="inventory" />
          <Stack.Screen name="devices" />
          <Stack.Screen name="settings" />
        </Stack>
        <ToastHost />
      </QueryClientProvider>
    </GestureHandlerRootView>
  )
}
