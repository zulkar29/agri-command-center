import { useEffect } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { router } from 'expo-router'
import { getDefaultStore, useAtomValue } from 'jotai'
import { farmService } from '@/services/farm'
import { ApiError, setSession } from '@/services/http'
import { initLang } from '@/i18n'
import type { AuthSession } from '@/lib/types'
import { bootedAtom, demoAtom, disconnect, serverUrlAtom, setDemo, setServerUrl } from './conn'
import { actions, hydrate, liveAtom } from './farm'
import { readSecret } from './storage'

const store = getDefaultStore()

/**
 * The app's data engine (mobile twin of dashboard's useLiveFarm +
 * simulator): while a server is configured and logged in, poll the farm
 * snapshot every 5s (backing off to 15s while unreachable) and hydrate the
 * store; while নমুনা মোড is on, tick the built-in simulation every 3s
 * instead.
 */
export function useFarmEngine() {
  const serverUrl = useAtomValue(serverUrlAtom)
  const demo = useAtomValue(demoAtom)
  const enabled = !!serverUrl && !demo

  // Read the persisted connection settings first and mirror them into the
  // atoms (the saved login token, from the keychain, goes to http.ts), then
  // raise the boot flag the route gate waits on — also when storage fails.
  useEffect(() => {
    void (async () => {
      await initLang()
      const [u, d, a] = await Promise.all([
        AsyncStorage.getItem('farm-command-server-url'),
        AsyncStorage.getItem('farm-command-demo'),
        readSecret('farm-command-auth'),
      ]).catch(() => [null, null, null]) // storage unreadable — boot as if nothing was saved
      if (u != null) {
        try {
          setServerUrl(JSON.parse(u) as string)
        } catch {
          // malformed value — treat as unset
        }
      }
      if (d != null) {
        try {
          setDemo(JSON.parse(d) === true)
        } catch {
          // malformed value — treat as unset
        }
      }
      if (a != null) {
        try {
          setSession(JSON.parse(a) as AuthSession)
        } catch {
          // malformed value — the first 401 will drop us back to connect
        }
      }
      store.set(bootedAtom, true)
    })()
  }, [])

  useEffect(() => {
    if (!enabled) {
      store.set(liveAtom, false)
      return undefined
    }
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const poll = async () => {
      try {
        const data = await farmService.get()
        if (stopped) return
        hydrate(data)
        store.set(liveAtom, true)
        timer = setTimeout(poll, 5_000)
      } catch (e) {
        if (stopped) return
        if (e instanceof ApiError && e.status === 401) {
          // the saved login is dead (expired or logged out elsewhere) —
          // back to the connect screen for fresh credentials
          disconnect()
          router.replace('/connect')
          return
        }
        store.set(liveAtom, false)
        timer = setTimeout(poll, 15_000)
      }
    }

    void poll()
    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
    }
  }, [enabled])

  // নমুনা মোড ticker — tick() itself no-ops unless `simulate` is on.
  useEffect(() => {
    const t = setInterval(() => actions.tick(), 3_000)
    return () => clearInterval(t)
  }, [])
}
