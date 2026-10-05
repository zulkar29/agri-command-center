import { View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useAtomValue } from 'jotai'
import { Card, CardDescription, CardTitle } from '@/components/ui/card'
import { AppText } from '@/components/ui/text'
import { bn, fmt } from '@/lib/format'
import { useWeeklySummary } from '@/services/reports'
import { demoAtom } from '@/state/conn'

/** The last seven days at a glance — the same numbers the Friday message sends to phones (live only). */
export function WeeklyCard() {
  const { t } = useTranslation()
  const demo = useAtomValue(demoAtom)
  const w = useWeeklySummary().data
  if (demo || !w) return null

  const profit = w.income - w.expense
  const lines = [
    w.pumpFlowKnown
      ? t('weekly.water', { n: bn(Math.round(w.litres)), runs: bn(w.pumpRuns) })
      : t('weekly.flowUnknown', { runs: bn(w.pumpRuns) }),
    t('weekly.money', {
      income: fmt(w.income),
      expense: fmt(w.expense),
      profit: `${profit < 0 ? '−' : ''}৳${fmt(Math.abs(profit))}`,
    }),
    w.harvestKg > 0 ? t('weekly.harvest', { n: bn(Math.round(w.harvestKg)) }) : '',
    t('weekly.tasks', { n: bn(w.openTasks) }) + (w.overdueTasks > 0 ? ` · ${t('weekly.overdue', { n: bn(w.overdueTasks) })}` : ''),
    w.lowStock.length > 0 ? t('weekly.buy', { names: w.lowStock.join(', ') }) : '',
    w.activeAlerts > 0 ? t('weekly.alerts', { n: bn(w.activeAlerts) }) : '',
  ].filter(Boolean)

  return (
    <Card>
      <CardTitle>{t('weekly.title')}</CardTitle>
      <CardDescription>{t('weekly.note')}</CardDescription>
      <View style={{ gap: 4 }}>
        {lines.map((l) => (
          <AppText key={l} style={{ lineHeight: 21 }}>
            {l}
          </AppText>
        ))}
      </View>
    </Card>
  )
}
