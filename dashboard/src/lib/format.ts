import { format } from 'date-fns'
import { bn as bnLocale, enGB } from 'date-fns/locale'
import i18n from '@/i18n'

const BN_DIGITS = '০১২৩৪৫৬৭৮৯'

/** Digits follow the UI language: ০-৯ in বাংলা, ASCII otherwise. */
export function bn(n: number | string): string {
  if (!i18n.language.startsWith('bn')) return String(n)
  return String(n).replace(/\d/g, (d) => BN_DIGITS[Number(d)])
}

/** 12000 -> ১২,০০০ (or 12,000 in English) */
export function fmt(n: number): string {
  return bn(n.toLocaleString('en-IN'))
}

/** Parse a number typed with Bangla or ASCII digits. Returns NaN if invalid. */
export function toNum(v: string): number {
  return parseFloat(
    v.replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d))).replace(/,/g, ''),
  )
}

/** "just now", "Today 07:00", "Yesterday 17:30" or a date, per language. */
export function whenLabel(at: number, now: number = Date.now()): string {
  const bn = i18n.language.startsWith('bn')
  const locale = bn ? 'bn-BD' : 'en-GB'
  const d = new Date(at)
  const t = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false })
  const dayStart = (x: number) => new Date(x).setHours(0, 0, 0, 0)
  const diffDays = Math.round((dayStart(now) - dayStart(at)) / 86_400_000)
  if (now - at < 60_000) return i18n.t('when.justNow')
  if (diffDays === 0) return i18n.t('when.todayAt', { t })
  if (diffDays === 1) return i18n.t('when.yesterdayAt', { t })
  return `${d.toLocaleDateString(locale, { day: 'numeric', month: 'long' })} ${t}`
}

/** A calendar date in the UI language, e.g. "৯ অক্টোবর" / "9 October" (no time). */
export function dateLabel(at: number): string {
  const locale = i18n.language.startsWith('bn') ? 'bn-BD' : 'en-GB'
  return new Date(at).toLocaleDateString(locale, { day: 'numeric', month: 'long' })
}

/** End of the local day for a yyyy-mm-dd input value, as epoch ms (NaN if invalid). */
export function endOfDay(isoDate: string): number {
  const [y, m, d] = isoDate.split('-').map(Number)
  if (!y || !m || !d) return NaN
  return new Date(y, m - 1, d, 23, 59, 0, 0).getTime()
}

/** date-fns `format` in the UI language: Bangla month/day names and digits in বাংলা. */
export function fmtDate(at: number | Date, pattern: string): string {
  const bnUi = i18n.language.startsWith('bn')
  return bn(format(at, pattern, { locale: bnUi ? bnLocale : enGB }))
}
