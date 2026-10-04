import { Platform } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as SecureStore from 'expo-secure-store'

/**
 * JSON-in-AsyncStorage adapter for jotai v3's atomWithStorage. Each atom gets
 * its own typed instance; values are stringified so anything storable works.
 * jotai v3 passes the atom's initial value to getItem — return it when the
 * key is missing or malformed so the atom never holds null.
 */
export function jsonAsyncStorage<T>() {
  return {
    async getItem(key: string, initialValue?: T): Promise<T> {
      const raw = await AsyncStorage.getItem(key)
      if (raw == null) return initialValue as T
      try {
        return JSON.parse(raw) as T
      } catch {
        return initialValue as T
      }
    },
    async setItem(key: string, newValue: T): Promise<void> {
      await AsyncStorage.setItem(key, JSON.stringify(newValue))
    },
    async removeItem(key: string): Promise<void> {
      await AsyncStorage.removeItem(key)
    },
  }
}

// SecureStore (Keychain / Keystore) has no web implementation — the web
// export keeps secrets in AsyncStorage (localStorage) like the dashboard does.
const secure = Platform.OS !== 'web'

/** Reads a secret; a value an older build left in AsyncStorage is moved over once. */
export async function readSecret(key: string): Promise<string | null> {
  if (!secure) return AsyncStorage.getItem(key)
  const v = await SecureStore.getItemAsync(key)
  if (v != null) return v
  const legacy = await AsyncStorage.getItem(key)
  if (legacy != null) {
    await SecureStore.setItemAsync(key, legacy)
    await AsyncStorage.removeItem(key)
  }
  return legacy
}

async function writeSecret(key: string, value: string | null): Promise<void> {
  if (!secure) {
    await (value == null ? AsyncStorage.removeItem(key) : AsyncStorage.setItem(key, value))
    return
  }
  await (value == null ? SecureStore.deleteItemAsync(key) : SecureStore.setItemAsync(key, value))
}

/**
 * Same contract as jsonAsyncStorage, but for secrets (the login session's
 * tokens): kept in the OS keychain via expo-secure-store, never in plain
 * AsyncStorage. A null value deletes the entry.
 */
export function jsonSecureStorage<T>() {
  return {
    async getItem(key: string, initialValue?: T): Promise<T> {
      const raw = await readSecret(key).catch(() => null)
      if (raw == null) return initialValue as T
      try {
        return JSON.parse(raw) as T
      } catch {
        return initialValue as T
      }
    },
    async setItem(key: string, newValue: T): Promise<void> {
      await writeSecret(key, newValue == null ? null : JSON.stringify(newValue))
    },
    async removeItem(key: string): Promise<void> {
      await writeSecret(key, null)
    },
  }
}
