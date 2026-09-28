import { bn, fmtDate } from '@/lib/format'

/**
 * Shared look for every chart (see components/echart.tsx): one palette with
 * farm meaning, a light card tooltip, quiet axes, and builders for the pieces
 * the farm charts repeat — gradient areas, agronomic bands, irrigation spans
 * and a time axis that reads in Bangla.
 */

/** Zone and generic series colors (zone ক, খ, গ first). */
export const CHART_COLORS = ['#1b6b43', '#2f7fc1', '#d19a1e', '#7c5cbf', '#c0392b']

/** Colors that mean the same thing on every chart. */
export const AGRO = {
  soil: '#1b6b43',
  water: '#2f7fc1',
  heat: '#d9480f',
  humidity: '#0c8599',
  vpd: '#7c5cbf',
  tank: '#1971c2',
  battery: '#d19a1e',
  income: '#1f7a4d',
  expense: '#c2410c',
  /** translucent band fills */
  bandDry: 'rgba(192, 57, 43, 0.07)',
  bandIdeal: 'rgba(31, 122, 77, 0.08)',
  bandWet: 'rgba(37, 99, 168, 0.07)',
  bandWarn: 'rgba(183, 121, 31, 0.09)',
  irrigation: 'rgba(47, 127, 193, 0.14)',
  ink: '#17231d',
} as const

export const CHART_TEXT = {
  fontFamily: "'Hind Siliguri', 'Noto Sans Bengali', sans-serif",
  color: '#3f4a42',
  fontSize: 12,
}

export const CHART_AXIS = {
  axisLine: { lineStyle: { color: '#d3cfc0' } },
  axisTick: { show: false },
  splitLine: { lineStyle: { color: '#efebe0', type: 'dashed' as const } },
  axisLabel: { color: '#646b62' },
}

/** The card-style tooltip every chart uses. */
export const CHART_TOOLTIP = {
  backgroundColor: 'rgba(255, 255, 255, 0.97)',
  borderColor: '#e6e2d4',
  borderWidth: 1,
  padding: [8, 12],
  textStyle: { ...CHART_TEXT, color: '#1a2a21', fontSize: 13 },
  extraCssText: 'border-radius: 10px; box-shadow: 0 8px 24px rgba(16, 40, 28, 0.12);',
}

/** Axis tooltip with a soft crosshair line. */
export const axisTooltip = (valueFormatter?: (v: unknown) => string) => ({
  ...CHART_TOOLTIP,
  trigger: 'axis' as const,
  axisPointer: { type: 'line' as const, lineStyle: { color: '#9aa39a', type: 'dashed' as const } },
  ...(valueFormatter ? { valueFormatter } : {}),
})

/** Legend at the top-left, round markers. */
export const CHART_LEGEND = { top: 0, left: 0, icon: 'circle', itemWidth: 9, itemHeight: 9, itemGap: 14, textStyle: CHART_TEXT }

/** Time label in the UI language: HH:mm within a day, "8 Oct" across days ("8 Oct 14:00" when detailed). */
export function timeLabel(ms: number, spanHours: number, detailed = false): string {
  if (spanHours <= 36) return fmtDate(ms, 'HH:mm')
  return fmtDate(ms, detailed ? 'd MMM HH:mm' : 'd MMM')
}

/** A time x-axis whose labels follow the span shown. */
export function timeAxis(spanHours: number) {
  return {
    type: 'time' as const,
    ...CHART_AXIS,
    splitLine: { show: false },
    axisLabel: { ...CHART_AXIS.axisLabel, hideOverlap: true, formatter: (v: number) => timeLabel(v, spanHours) },
    axisPointer: { label: { formatter: (p: { value: number }) => timeLabel(p.value, spanHours, true) } },
  }
}

/** A percent y-axis (0–100 by default). */
export function percentAxis(extra: Record<string, unknown> = {}) {
  return {
    type: 'value' as const,
    min: 0,
    max: 100,
    ...CHART_AXIS,
    axisLabel: { ...CHART_AXIS.axisLabel, formatter: (v: number) => `${bn(v)}%` },
    ...extra,
  }
}

/** A value y-axis with a unit suffix. */
export function unitAxis(unit: string, extra: Record<string, unknown> = {}) {
  return {
    type: 'value' as const,
    scale: true,
    ...CHART_AXIS,
    axisLabel: { ...CHART_AXIS.axisLabel, formatter: (v: number) => `${bn(Math.round(v * 10) / 10)}${unit}` },
    ...extra,
  }
}

/** Vertical gradient from `color` at `top` opacity to transparent. */
export function fade(color: string, top = 0.28) {
  const hex = color.replace('#', '')
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16))
  return {
    type: 'linear' as const,
    x: 0,
    y: 0,
    x2: 0,
    y2: 1,
    colorStops: [
      { offset: 0, color: `rgba(${r}, ${g}, ${b}, ${top})` },
      { offset: 1, color: `rgba(${r}, ${g}, ${b}, 0)` },
    ],
  }
}

/** A smooth line; `area` adds a gradient fill under it. Data is [ms, value] pairs (null = gap). */
export function lineSeries(name: string, color: string, data: [number, number | null][], opts: { area?: boolean; yAxisIndex?: number; width?: number; dashed?: boolean } = {}) {
  return {
    name,
    type: 'line' as const,
    smooth: 0.35,
    showSymbol: false,
    symbol: 'circle',
    symbolSize: 7,
    connectNulls: false,
    yAxisIndex: opts.yAxisIndex ?? 0,
    color,
    lineStyle: { width: opts.width ?? 2.5, color, type: opts.dashed ? ('dashed' as const) : ('solid' as const) },
    emphasis: { focus: 'series' as const },
    ...(opts.area ? { areaStyle: { color: fade(color) } } : {}),
    data,
  }
}

/** Horizontal bands (agronomic ranges) as a markArea; label sits inside on the right. */
export function bandsArea(bands: { from: number; to: number; color: string; label?: string }[]) {
  return {
    silent: true,
    data: bands.map((b) => [
      { yAxis: b.from, itemStyle: { color: b.color }, label: { show: !!b.label, formatter: b.label ?? '', position: 'insideTopRight', color: '#646b62', fontSize: 11 } },
      { yAxis: b.to },
    ]),
  }
}

/** Vertical spans on a time axis (irrigation runs) as a markArea. */
export function spansArea(spans: { start: number; end: number }[], color: string, label?: string) {
  return {
    silent: true,
    itemStyle: { color },
    label: { show: false },
    data: spans.map((s, i) => [{ xAxis: s.start, label: { show: !!label && i === spans.length - 1, formatter: label ?? '', position: 'insideTop', color: '#1d5c9e', fontSize: 11 } }, { xAxis: s.end }]),
  }
}

/** A dashed reference line at y (threshold, refill level). */
export function refLine(y: number, label: string, color: string = AGRO.ink) {
  return {
    silent: true,
    symbol: 'none',
    lineStyle: { type: 'dashed' as const, color, width: 1.5 },
    label: { formatter: label, color, position: 'insideEndTop' as const, fontSize: 11 },
    data: [{ yAxis: y }],
  }
}

/** Wheel/drag zoom on the time axis plus a slim slider, for spans worth zooming into. */
export function zoomControls(show: boolean) {
  if (!show) return []
  return [
    { type: 'inside', xAxisIndex: 0, filterMode: 'none' },
    {
      type: 'slider',
      xAxisIndex: 0,
      height: 18,
      bottom: 4,
      borderColor: 'transparent',
      backgroundColor: '#f4f1e8',
      fillerColor: 'rgba(27, 107, 67, 0.12)',
      handleStyle: { color: '#1b6b43', borderColor: '#1b6b43' },
      moveHandleSize: 0,
      dataBackground: { lineStyle: { color: '#c9c4b3' }, areaStyle: { color: '#e6e2d4' } },
      textStyle: { color: 'transparent' },
      filterMode: 'none',
    },
  ]
}
