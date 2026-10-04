// i18next's named exports are bound to the default instance; `use` is renamed
// so the React hooks lint rule doesn't mistake it for React's use()
import i18next, { changeLanguage, use as register } from 'i18next'
import { initReactI18next } from 'react-i18next'
import AsyncStorage from '@react-native-async-storage/async-storage'
import bn from './bn.json'
import en from './en.json'

export const LANG_KEY = 'farm-command-lang'
export type Lang = 'bn' | 'en'

/**
 * UI languages — the mobile twin of dashboard/src/i18n. বাংলা is the default
 * and the fallback; the chosen language persists in AsyncStorage. Storage is
 * async, so the saved language is applied in state/engine.ts during boot
 * (init can't await it).
 */
void register(initReactI18next).init({
  resources: { bn: { translation: bn }, en: { translation: en } },
  lng: 'bn',
  fallbackLng: 'bn',
  interpolation: { escapeValue: false }, // React already escapes
})

export async function initLang(): Promise<void> {
  try {
    const saved = await AsyncStorage.getItem(LANG_KEY)
    if (saved === 'bn' || saved === 'en') await changeLanguage(saved)
  } catch {
    // storage unavailable — বাংলা default
  }
}

export function setLang(lang: Lang) {
  void changeLanguage(lang)
  void AsyncStorage.setItem(LANG_KEY, lang).catch(() => {
    // storage unavailable — language still applies for this session
  })
}

export default i18next
