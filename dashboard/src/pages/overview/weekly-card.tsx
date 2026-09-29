import { CalendarDays } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { bn, fmt } from '@/lib/format'
import { useFarm } from '@/atoms/farm'
import { useWeeklySummary } from '@/services/reports'

/** The last seven days at a glance — the same numbers the Friday message sends to phones (live only). */
export function WeeklyCard() {
  const { t } = useTranslation()
  const simulate = useFarm((s) => s.simulate)
  const w = useWeeklySummary().data
  if (simulate || !w) return null

  const profit = w.income - w.expense
  const lines = [
    w.pumpFlowKnown
      ? t('weekly.water', { n: bn(Math.round(w.litres)), runs: bn(w.pumpRuns) })
      : t('weekly.flowUnknown', { runs: bn(w.pumpRuns) }),
    t('weekly.money', {
      income: fmt(Math.round(w.income)),
      expense: fmt(Math.round(w.expense)),
      profit: `${profit < 0 ? '−' : ''}৳${fmt(Math.abs(Math.round(profit)))}`,
    }),
    w.harvestKg > 0 ? t('weekly.harvest', { n: bn(Math.round(w.harvestKg)) }) : '',
    t('weekly.tasks', { n: bn(w.openTasks) }) + (w.overdueTasks > 0 ? ` · ${t('weekly.overdue', { n: bn(w.overdueTasks) })}` : ''),
    w.lowStock.length > 0 ? t('weekly.buy', { names: w.lowStock.join(', ') }) : '',
    w.activeAlerts > 0 ? t('weekly.alerts', { n: bn(w.activeAlerts) }) : '',
  ].filter(Boolean)

  return (
    <Card>
      <CardHeader>
        <CardTitle icon={CalendarDays}>{t('weekly.title')}</CardTitle>
        <CardDescription>{t('weekly.note')}</CardDescription>
      </CardHeader>
      <ul className="flex flex-col gap-1.5">
        {lines.map((l) => (
          <li key={l} className="leading-relaxed">
            {l}
          </li>
        ))}
      </ul>
    </Card>
  )
}
