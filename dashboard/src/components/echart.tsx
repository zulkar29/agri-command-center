import { useEffect, useRef } from 'react'
import * as echarts from 'echarts/core'
import type { EChartsCoreOption } from 'echarts/core'
import { BarChart, HeatmapChart, LineChart, PieChart } from 'echarts/charts'
import { DataZoomComponent, GridComponent, LegendComponent, MarkAreaComponent, MarkLineComponent, TooltipComponent, VisualMapComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { CHART_TEXT } from '@/lib/chart-theme'
import { cn } from '@/lib/utils'

// Only the parts of Apache ECharts we use are bundled.
echarts.use([BarChart, HeatmapChart, LineChart, PieChart, DataZoomComponent, GridComponent, LegendComponent, MarkAreaComponent, MarkLineComponent, TooltipComponent, VisualMapComponent, CanvasRenderer])

interface EChartProps {
  option: EChartsCoreOption
  /** accessible description of the chart */
  label: string
  height?: number
  className?: string
}

export function EChart({ option, label, height = 260, className }: EChartProps) {
  const el = useRef<HTMLDivElement>(null)
  const chart = useRef<echarts.ECharts | null>(null)

  useEffect(() => {
    if (!el.current) return
    const c = echarts.init(el.current)
    chart.current = c
    const ro = new ResizeObserver(() => c.resize())
    ro.observe(el.current)
    return () => {
      ro.disconnect()
      c.dispose()
      chart.current = null
    }
  }, [])

  useEffect(() => {
    chart.current?.setOption({ textStyle: CHART_TEXT, ...option }, true)
  }, [option])

  return <div ref={el} role="img" aria-label={label} className={cn('w-full', className)} style={{ height }} />
}
