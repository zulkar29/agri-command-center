import type { Tone } from './types'

/**
 * Light theme mirroring the dashboard's CSS variables (dashboard/src/index.css)
 * so both clients feel like one product.
 */
export const C = {
  bg: '#f3f5f2',
  ink: '#17231d',
  card: '#ffffff',
  muted: '#5c6b63',
  border: '#e1e6df',
  input: '#cfd8d1',
  secondary: '#eef2ee',
  accent: '#e9f0ea',
  primary: '#1f7a4d',
  onPrimary: '#ffffff',
  destructive: '#c0392b',
  ok: '#1f7a4d',
  okSoft: '#eaf6ef',
  okLine: '#b9dcc9',
  okInk: '#1b5e3b',
  warn: '#b7791f',
  warnSoft: '#fdf3dc',
  warnLine: '#f0d9a0',
  warnInk: '#8a5a00',
  bad: '#c0392b',
  badSoft: '#fdecea',
  badLine: '#f3c1bd',
  badInk: '#b3261e',
  info: '#2563a8',
  infoSoft: '#e8f1fb',
  infoLine: '#bcd5ee',
  infoInk: '#1d5c9e',
  neutral: '#5c6b63',
  neutralSoft: '#eef1ee',
  chart: ['#1f7a4d', '#2563a8', '#b7791f', '#7c3aed', '#c0392b'],
} as const

export interface ToneColors {
  /** solid dot/bar color */
  solid: string
  /** soft chip background */
  soft: string
  /** chip border */
  line: string
  /** chip text */
  ink: string
}

export const tone: Record<Tone, ToneColors> = {
  ok: { solid: C.ok, soft: C.okSoft, line: C.okLine, ink: C.okInk },
  warn: { solid: C.warn, soft: C.warnSoft, line: C.warnLine, ink: C.warnInk },
  bad: { solid: C.bad, soft: C.badSoft, line: C.badLine, ink: C.badInk },
  info: { solid: C.info, soft: C.infoSoft, line: C.infoLine, ink: C.infoInk },
  neutral: { solid: C.neutral, soft: C.neutralSoft, line: C.border, ink: C.muted },
}

export const R = { sm: 6, md: 10, lg: 14 } as const
