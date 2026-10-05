import { useState } from 'react'
import { View } from 'react-native'
import Svg, { Line, Path, Rect, Text as SvgText } from 'react-native-svg'
import { bn } from '@/lib/format'
import { F } from '@/lib/fonts'
import { C } from '@/lib/theme'
import { AppText } from './ui/text'

export interface ChartSeries {
  name: string
  color: string
  data: number[]
}

const PAD = { l: 40, r: 12, t: 8, b: 20 }

function useChartWidth() {
  const [w, setW] = useState(0)
  const onLayout = (e: { nativeEvent: { layout: { width: number } } }) =>
    setW(e.nativeEvent.layout.width)
  return { w, onLayout }
}

function xLabelEvery(n: number) {
  return Math.max(1, Math.ceil(n / 6))
}

/**
 * Multi-series line chart drawn with react-native-svg — the mobile stand-in
 * for the dashboard's ECharts lines. Values render with Bangla digits.
 */
export function LineChart({
  series,
  labels,
  yMin,
  yMax,
  marker,
  height = 200,
  yFmt = (v: number) => bn(Math.round(v)),
  legend = true,
}: {
  series: ChartSeries[]
  labels: string[]
  yMin: number
  yMax: number
  /** dashed horizontal reference, e.g. the irrigation threshold */
  marker?: { value: number; label: string }
  height?: number
  yFmt?: (v: number) => string
  legend?: boolean
}) {
  const { w, onLayout } = useChartWidth()
  const n = labels.length
  if (n < 2 || series.every((s) => s.data.length < 2)) {
    return <View style={{ height }} onLayout={onLayout} />
  }
  const plotW = Math.max(10, w - PAD.l - PAD.r)
  const plotH = height - PAD.t - PAD.b
  const x = (i: number) => PAD.l + (i / (n - 1)) * plotW
  const y = (v: number) =>
    PAD.t + (1 - (Math.max(yMin, Math.min(yMax, v)) - yMin) / (yMax - yMin || 1)) * plotH

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => yMin + f * (yMax - yMin))
  const every = xLabelEvery(n)

  return (
    <View style={{ gap: 6 }} onLayout={onLayout} collapsable={false}>
      {legend ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
          {series.map((s) => (
            <View key={s.name} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <View style={{ width: 10, height: 4, borderRadius: 2, backgroundColor: s.color }} />
              <AppText style={{ fontSize: 12, color: C.muted }}>{s.name}</AppText>
            </View>
          ))}
        </View>
      ) : null}
      {w > 0 ? (
        <Svg width={w} height={height}>
          {ticks.map((t, i) => (
            <Line
              key={`g${i}`}
              x1={PAD.l}
              x2={w - PAD.r}
              y1={y(t)}
              y2={y(t)}
              stroke="#e1e6df"
              strokeWidth={1}
            />
          ))}
          {ticks.map((t, i) => (
            <SvgText
              key={`t${i}`}
              x={PAD.l - 6}
              y={y(t) + 3}
              textAnchor="end"
              fontSize={9}
              fill={C.muted}
              fontFamily={F.reg}
            >
              {yFmt(t)}
            </SvgText>
          ))}
          {marker && marker.value >= yMin && marker.value <= yMax ? (
            <>
              <Line
                x1={PAD.l}
                x2={w - PAD.r}
                y1={y(marker.value)}
                y2={y(marker.value)}
                stroke={C.ink}
                strokeWidth={1.2}
                strokeDasharray="5 4"
              />
              <SvgText
                x={w - PAD.r}
                y={y(marker.value) - 4}
                textAnchor="end"
                fontSize={9}
                fill={C.ink}
                fontFamily={F.semi}
              >
                {marker.label}
              </SvgText>
            </>
          ) : null}
          {series.map((s) => {
            const pts = s.data.slice(0, n)
            let d = `M ${x(0)} ${y(pts[0])}`
            for (let i = 1; i < n; i++) {
              const mx = (x(i - 1) + x(i)) / 2
              d += ` C ${mx} ${y(pts[i - 1])}, ${mx} ${y(pts[i])}, ${x(i)} ${y(pts[i])}`
            }
            return <Path key={s.name} d={d} stroke={s.color} strokeWidth={2.2} fill="none" />
          })}
          {labels.map((l, i) =>
            i % every === 0 || i === n - 1 ? (
              <SvgText
                key={`x${i}`}
                x={x(i)}
                y={height - 5}
                textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}
                fontSize={9}
                fill={C.muted}
                fontFamily={F.reg}
              >
                {l}
              </SvgText>
            ) : null,
          )}
        </Svg>
      ) : (
        <View style={{ height }} />
      )}
    </View>
  )
}

/** Single-series bar chart (e.g. daily water usage). */
export function BarChart({
  data,
  labels,
  color = C.info,
  height = 180,
  yFmt = (v: number) => bn(Math.round(v)),
}: {
  data: number[]
  labels: string[]
  color?: string
  height?: number
  yFmt?: (v: number) => string
}) {
  const { w, onLayout } = useChartWidth()
  const n = data.length
  if (n < 1) return <View style={{ height }} onLayout={onLayout} />
  const max = Math.max(...data, 1)
  const plotW = Math.max(10, w - PAD.l - PAD.r)
  const plotH = height - PAD.t - PAD.b
  const step = plotW / n
  const barW = Math.min(30, step * 0.62)
  const y = (v: number) => PAD.t + (1 - v / max) * plotH
  const ticks = [0, 0.5, 1].map((f) => f * max)
  const every = xLabelEvery(n)

  return (
    <View style={{ gap: 6 }} onLayout={onLayout} collapsable={false}>
      {w > 0 ? (
        <Svg width={w} height={height}>
          {ticks.map((t, i) => (
            <Line
              key={i}
              x1={PAD.l}
              x2={w - PAD.r}
              y1={y(t)}
              y2={y(t)}
              stroke="#e1e6df"
              strokeWidth={1}
            />
          ))}
          {ticks.map((t, i) => (
            <SvgText
              key={`t${i}`}
              x={PAD.l - 6}
              y={y(t) + 3}
              textAnchor="end"
              fontSize={9}
              fill={C.muted}
              fontFamily={F.reg}
            >
              {yFmt(t)}
            </SvgText>
          ))}
          {data.map((v, i) => {
            const h = Math.max(v > 0 ? 3 : 0, PAD.t + plotH - y(v))
            return (
              <Rect
                key={i}
                x={PAD.l + i * step + (step - barW) / 2}
                y={PAD.t + plotH - h}
                width={barW}
                height={h}
                rx={3}
                fill={color}
                opacity={v > 0 ? 1 : 0.25}
              />
            )
          })}
          {labels.map((l, i) =>
            i % every === 0 || i === n - 1 ? (
              <SvgText
                key={`x${i}`}
                x={PAD.l + i * step + step / 2}
                y={height - 5}
                textAnchor="middle"
                fontSize={9}
                fill={C.muted}
                fontFamily={F.reg}
              >
                {l}
              </SvgText>
            ) : null,
          )}
        </Svg>
      ) : (
        <View style={{ height }} />
      )}
    </View>
  )
}
