import { Power, Radio, RadioTower } from 'lucide-react'

/** Icon per device kind, shared by the list, the details and the attention panel. */
export const KIND_ICON = { gateway: RadioTower, sensor: Radio, relay: Power } as const

/** Badge/panel tone for each device health. */
export const HEALTH_TONE = { ok: 'ok', warn: 'warn', bad: 'bad', idle: 'neutral' } as const
