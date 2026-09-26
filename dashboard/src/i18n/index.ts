import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import bn from './bn.json'
import en from './en.json'

export const LANG_KEY = 'farm-command-lang'
export type Lang = 'bn' | 'en'

/**
 * UI languages. বাংলা is the default and the fallback — server-side strings
 * (seeded data, irrigation log lines, API error messages) stay Bengali, so an
 * English UI may still show Bengali data; only the interface chrome
 * translates. The chosen language persists in localStorage (see setLang).
 */
// keep <html lang> in step so screen readers and hyphenation follow the UI language
i18next.on('languageChanged', (lng) => {
  if (typeof document !== 'undefined') document.documentElement.lang = lng
})

void i18next.use(initReactI18next).init({
  resources: { bn: { translation: bn }, en: { translation: en } },
  lng: initialLang(),
  fallbackLng: 'bn',
  interpolation: { escapeValue: false }, // React already escapes
})

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(LANG_KEY)
    if (saved === 'bn' || saved === 'en') return saved
  } catch {
    // localStorage unavailable (tests) — বাংলা default
  }
  return 'bn'
}

export function setLang(lang: Lang) {
  void i18next.changeLanguage(lang)
  try {
    localStorage.setItem(LANG_KEY, lang)
  } catch {
    // storage unavailable — language still applies for this session
  }
}

export default i18next
