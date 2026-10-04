import i18n from '@/i18n'

/**
 * Display labels for data-valued enums (zones, dues, assignees, roles, obs
 * kinds, ledger categories, forecast days) — the mobile twin of
 * dashboard/src/lib/labels.ts. The VALUES stay Bengali (they are stored in
 * the database and filter the API); only the on-screen label translates.
 * Anything unknown (a hand-typed category, say) shows as-is.
 */

const ZONE_KEYS: Record<string, string> = { 'জোন ক': 'zone.a', 'জোন খ': 'zone.b', 'জোন গ': 'zone.c' }

export const zoneLabel = (z: string) => i18n.t(ZONE_KEYS[z] ?? '', { defaultValue: z })
export const dueLabel = (d: string) => i18n.t(`due.${d}`, { defaultValue: d })
export const assigneeLabel = (a: string) => i18n.t(`assignee.${a}`, { defaultValue: a })
export const roleLabel = (r: string) => i18n.t(`role.${r}`, { defaultValue: r })
export const obsKindLabel = (k: string) => i18n.t(`obsKind.${k}`, { defaultValue: k })
export const catLabel = (c: string) => i18n.t(`cat.${c}`, { defaultValue: c })
export const forecastDayLabel = (d: string) => i18n.t(`forecastDay.${d}`, { defaultValue: d })
