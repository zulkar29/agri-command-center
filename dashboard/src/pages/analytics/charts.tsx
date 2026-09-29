import { useMemo } from 'react'
import type { EChartsCoreOption } from 'echarts/core'
import { useTranslation } from 'react-i18next'
import { EChart } from '@/components/echart'
import { ZONES } from '@/data/constants'
import { moistureBands, VPD_LIMITS, HEAT_STRESS_C, type Point } from '@/lib/agro'
import {
  AGRO,
  axisTooltip,
  bandsArea,
  CHART_AXIS,
  CHART_COLORS,
  CHART_LEGEND,
  CHART_TOOLTIP,
  lineSeries,
  percentAxis,
  refLine,
  spansArea,
  timeAxis,
  unitAxis,
  zoomControls,
} from '@/lib/chart-theme'
import { bn, fmtDate } from '@/lib/format'
import { zoneLabel } from '@/lib/labels'
import type { FieldEfficiency } from '@/services/harvest'
import { TANK_REFILL, type Analytics } from './derive'

/**
 * The analytics charts. Every time series shares the time axis, the card
 * tooltip and zoom (from 7 days up), and draws the agronomic meaning onto the
 * chart itself — bands, thresholds, irrigation spans — instead of leaving the
 * reader to remember what a number means.
 */

const pairs = (pts: Point[]): [number, number][] => pts.map((p) => [p.t, p.v])
const zoneName = (i: number) => zoneLabel(ZONES[i] ?? `জোন ${i + 1}`)

interface SeriesProps {
  a: Analytics
  spanHours: number
}

/** Soil moisture per zone over the dry / ideal / wet bands, with pump runs shaded in. */
export function SoilChart({ a, spanHours, threshold }: SeriesProps & { threshold: number }) {
  const { t } = useTranslation()
  const zoom = spanHours > 24
  const option = useMemo<EChartsCoreOption>(() => {
    const { dryBelow, wetAbove } = moistureBands(threshold)
    return {
      color: CHART_COLORS,
      grid: { left: 44, right: 14, top: 40, bottom: zoom ? 54 : 26 },
      tooltip: axisTooltip((v) => `${bn(Math.round(Number(v)))}%`),
      legend: { ...CHART_LEGEND, data: a.zones.map((z) => zoneName(z.index)) },
      xAxis: timeAxis(spanHours),
      yAxis: percentAxis(),
      dataZoom: zoomControls(zoom),
      series: [
        ...a.zones.map((z, i) => ({
          ...lineSeries(zoneName(z.index), CHART_COLORS[i % CHART_COLORS.length], pairs(z.points), { area: i === 0 }),
          ...(i === 0
            ? {
                markArea: bandsArea([
                  { from: 0, to: dryBelow, color: AGRO.bandDry, label: t('ag.soil.dry') },
                  { from: dryBelow, to: wetAbove, color: AGRO.bandIdeal, label: t('ag.soil.ideal') },
                  { from: wetAbove, to: 100, color: AGRO.bandWet, label: t('ag.soil.wet') },
                ]),
                markLine: refLine(threshold, t('ag.soil.threshold', { n: bn(threshold) }), '#b3261e'),
              }
            : {}),
        })),
        // pump runs as an invisible series that owns the shaded spans
        {
          name: t('ag.soil.irrigation'),
          type: 'line',
          data: [],
          markArea: spansArea(a.spans, AGRO.irrigation, t('ag.soil.irrigation')),
          tooltip: { show: false },
        },
      ],
    }
  }, [a, spanHours, threshold, zoom, t])
  return <EChart option={option} label={t('ag.soil.chartLabel')} height={340} />
}

/** Air temperature (with the heat-stress band) and humidity. */
export function ClimateChart({ a, spanHours }: SeriesProps) {
  const { t } = useTranslation()
  const zoom = spanHours > 24
  const option = useMemo<EChartsCoreOption>(() => {
    const top = Math.max(HEAT_STRESS_C + 4, Math.ceil((a.tempMax ?? 0) + 2))
    return {
      grid: { left: 40, right: 44, top: 40, bottom: zoom ? 54 : 26 },
      tooltip: axisTooltip(),
      legend: CHART_LEGEND,
      xAxis: timeAxis(spanHours),
      yAxis: [
        unitAxis('°', { scale: false, min: (v: { min: number }) => Math.floor(v.min - 2), max: top }),
        percentAxis({ splitLine: { show: false } }),
      ],
      dataZoom: zoomControls(zoom),
      series: [
        {
          ...lineSeries(t('ag.climate.temp'), AGRO.heat, pairs(a.temp), { area: true }),
          tooltip: { valueFormatter: (v: unknown) => `${bn(Number(v).toFixed(1))}°` },
          markArea: bandsArea([{ from: HEAT_STRESS_C, to: top, color: AGRO.bandWarn, label: t('ag.climate.heat') }]),
        },
        {
          ...lineSeries(t('ag.climate.rh'), AGRO.humidity, pairs(a.humidity), { yAxisIndex: 1, width: 2, dashed: true }),
          tooltip: { valueFormatter: (v: unknown) => `${bn(Math.round(Number(v)))}%` },
        },
      ],
    }
  }, [a, spanHours, zoom, t])
  return <EChart option={option} label={t('ag.climate.chartLabel')} height={280} />
}

/** VPD over the disease / ideal / stress bands. */
export function VpdChart({ a, spanHours }: SeriesProps) {
  const { t } = useTranslation()
  const zoom = spanHours > 24
  const option = useMemo<EChartsCoreOption>(() => {
    const top = Math.max(2.2, Math.ceil(Math.max(0, ...a.vpd.map((p) => p.v)) * 10 + 1) / 10)
    return {
      grid: { left: 44, right: 14, top: 18, bottom: zoom ? 54 : 26 },
      tooltip: axisTooltip((v) => `${bn(Number(v).toFixed(2))} kPa`),
      xAxis: timeAxis(spanHours),
      yAxis: unitAxis('', { scale: false, min: 0, max: top }),
      dataZoom: zoomControls(zoom),
      series: [
        {
          ...lineSeries(t('ag.vpd.series'), AGRO.vpd, pairs(a.vpd), { area: true }),
          markArea: bandsArea([
            { from: 0, to: VPD_LIMITS.disease, color: AGRO.bandWet, label: t('ag.vpd.disease') },
            { from: VPD_LIMITS.low, to: VPD_LIMITS.ideal, color: AGRO.bandIdeal, label: t('ag.vpd.ideal') },
            { from: VPD_LIMITS.high, to: top, color: AGRO.bandDry, label: t('ag.vpd.stress') },
          ]),
        },
      ],
    }
  }, [a, spanHours, zoom, t])
  return <EChart option={option} label={t('ag.vpd.chartLabel')} height={280} />
}

/** Tank level with the refill line. */
export function TankChart({ a, spanHours }: SeriesProps) {
  const { t } = useTranslation()
  const option = useMemo<EChartsCoreOption>(
    () => ({
      grid: { left: 44, right: 14, top: 18, bottom: 26 },
      tooltip: axisTooltip((v) => `${bn(Math.round(Number(v)))}%`),
      xAxis: timeAxis(spanHours),
      yAxis: percentAxis(),
      series: [
        {
          ...lineSeries(t('ag.tank.series'), AGRO.tank, pairs(a.tank), { area: true }),
          markLine: refLine(TANK_REFILL, t('ag.tank.refill'), '#b3261e'),
          markArea: bandsArea([{ from: 0, to: TANK_REFILL, color: AGRO.bandDry }]),
        },
      ],
    }),
    [a, spanHours, t],
  )
  return <EChart option={option} label={t('ag.tank.chartLabel')} height={220} />
}

/** Litres per day, stacked by zone. */
export function WaterChart({ a }: { a: Analytics }) {
  const { t } = useTranslation()
  const option = useMemo<EChartsCoreOption>(() => {
    const zones = a.zones.length || 1
    return {
      color: CHART_COLORS,
      grid: { left: 52, right: 10, top: 40, bottom: 26 },
      tooltip: { ...axisTooltip((v) => t('ag.kpi.litres', { n: bn(Math.round(Number(v))) })), axisPointer: { type: 'shadow' } },
      legend: CHART_LEGEND,
      xAxis: { type: 'category', data: a.waterByDay.map((d) => fmtDate(d.day, 'd MMM')), ...CHART_AXIS },
      yAxis: unitAxis('', { scale: false, min: 0 }),
      series: Array.from({ length: zones }, (_, z) => ({
        name: zoneName(z),
        type: 'bar',
        stack: 'water',
        barMaxWidth: 26,
        itemStyle: { borderRadius: z === zones - 1 ? [5, 5, 0, 0] : 0 },
        emphasis: { focus: 'series' },
        data: a.waterByDay.map((d) => d.perZone[z] ?? 0),
      })),
    }
  }, [a, t])
  return <EChart option={option} label={t('ag.water.chartLabel')} height={260} />
}

/** Litres per kg per field, best first and colored from best (green) to worst (orange). */
export function EfficiencyChart({ items }: { items: FieldEfficiency[] }) {
  const { t } = useTranslation()
  const option = useMemo<EChartsCoreOption>(() => {
    const rows = items.filter((e) => e.litresPerKg !== null).sort((x, y) => (x.litresPerKg ?? 0) - (y.litresPerKg ?? 0))
    const max = Math.max(1, ...rows.map((r) => r.litresPerKg ?? 0))
    return {
      grid: { left: 4, right: 70, top: 6, bottom: 6, containLabel: true },
      tooltip: { ...CHART_TOOLTIP, trigger: 'item', formatter: (p: { name: string; value: number }) => `${p.name}<br/><b>${bn(Math.round(p.value))}</b> ${t('ag.eff.perKg')}` },
      xAxis: { type: 'value', show: false, max: max * 1.05 },
      yAxis: { type: 'category', inverse: true, data: rows.map((r) => r.name), ...CHART_AXIS, axisLine: { show: false } },
      series: [
        {
          type: 'bar',
          barMaxWidth: 20,
          showBackground: true,
          backgroundStyle: { color: '#f4f1e8', borderRadius: 6 },
          itemStyle: { borderRadius: 6 },
          label: { show: true, position: 'right', color: '#3f4a42', formatter: (p: { value: number }) => `${bn(Math.round(p.value))} ${t('ag.eff.perKg')}` },
          data: rows.map((r, i) => ({
            name: r.name,
            value: r.litresPerKg,
            itemStyle: { color: i === 0 ? AGRO.income : (r.litresPerKg ?? 0) > max * 0.75 ? AGRO.expense : AGRO.battery },
          })),
        },
      ],
    }
  }, [items, t])
  const rows = items.filter((e) => e.litresPerKg !== null).length
  return <EChart option={option} label={t('ag.eff.chartLabel')} height={Math.max(90, rows * 42 + 12)} />
}

/**
 * How often each zone was near or below the threshold at each hour of the
 * day (share of days): the hours a schedule should water ahead of.
 */
export function DryingHeatmap({ a, threshold }: { a: Analytics; threshold: number }) {
  const { t } = useTranslation()
  const option = useMemo<EChartsCoreOption>(() => {
    const edge = threshold + 5
    const cells: [number, number, number, number][] = [] // hour, zone, % near/below, average
    a.zones.forEach((z, zi) => {
      const dry = Array.from({ length: 24 }, () => 0)
      const sum = Array.from({ length: 24 }, () => 0)
      const n = Array.from({ length: 24 }, () => 0)
      for (const p of z.points) {
        const h = new Date(p.t).getHours()
        if (p.v < edge) dry[h] += 1
        sum[h] += p.v
        n[h] += 1
      }
      for (let h = 0; h < 24; h++) if (n[h]) cells.push([h, zi, Math.round((100 * dry[h]) / n[h]), Math.round(sum[h] / n[h])])
    })
    return {
      grid: { left: 64, right: 10, top: 8, bottom: 58 },
      tooltip: {
        ...CHART_TOOLTIP,
        formatter: (p: { value: [number, number, number, number] }) =>
          `${zoneName(p.value[1])} · ${bn(String(p.value[0]).padStart(2, '0'))}:০০<br/>${t('ag.heat.tip', { n: bn(p.value[2]), avg: bn(p.value[3]) })}`,
      },
      xAxis: { type: 'category', data: Array.from({ length: 24 }, (_, h) => bn(String(h).padStart(2, '0'))), ...CHART_AXIS, splitArea: { show: false } },
      yAxis: { type: 'category', inverse: true, data: a.zones.map((z) => zoneName(z.index)), ...CHART_AXIS },
      visualMap: {
        type: 'piecewise',
        dimension: 2,
        orient: 'horizontal',
        left: 'center',
        bottom: 0,
        itemWidth: 12,
        itemHeight: 12,
        textStyle: { color: '#3f4a42' },
        pieces: [
          { lte: 0, color: '#5fae7f', label: t('ag.heat.never') },
          { gt: 0, lte: 25, color: '#f0c36d', label: t('ag.heat.sometimes') },
          { gt: 25, lte: 60, color: '#ee9a4d', label: t('ag.heat.often') },
          { gt: 60, color: '#e4685c', label: t('ag.heat.mostly') },
        ],
      },
      series: [
        {
          type: 'heatmap',
          data: cells,
          label: { show: true, color: '#17231d', fontSize: 10, formatter: (p: { value: number[] }) => (p.value[2] ? `${bn(p.value[2])}%` : '') },
          itemStyle: { borderColor: '#fff', borderWidth: 2, borderRadius: 4 },
          emphasis: { itemStyle: { borderColor: '#17231d', borderWidth: 1 } },
        },
      ],
    }
  }, [a, threshold, t])
  return <EChart option={option} label={t('ag.heat.chartLabel')} height={Math.max(170, a.zones.length * 40 + 80)} />
}
