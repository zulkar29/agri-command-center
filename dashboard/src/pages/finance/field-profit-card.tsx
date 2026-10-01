import { TrendingUp } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { fmt } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useFarm } from '@/atoms/farm'
import { useFieldProfit } from '@/services/reports'

/** Income, expense and profit per field, from the ledger entries tagged with it (live only). */
export function FieldProfitCard() {
  const { t } = useTranslation()
  const simulate = useFarm((s) => s.simulate)
  const rows = useFieldProfit().data ?? []
  if (simulate) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle icon={TrendingUp}>{t('fieldProfit.title')}</CardTitle>
        <CardDescription>{t('fieldProfit.note')}</CardDescription>
      </CardHeader>
      {rows.map((r) => (
        <div key={r.fieldId || 'untagged'} className="flex flex-wrap items-baseline justify-between gap-2 border-t py-2.5 first:border-t-0 first:pt-0">
          <div className="flex min-w-0 flex-col">
            <span className="font-semibold">{r.fieldId ? r.name : t('fieldProfit.untagged')}</span>
            <span className="text-[13px] text-muted-foreground">
              +৳{fmt(r.income)} · −৳{fmt(r.expense)}
              {r.profitPerShotok != null ? ` · ${t('fieldProfit.perShotok', { n: `${r.profitPerShotok < 0 ? '−' : ''}৳${fmt(Math.abs(Math.round(r.profitPerShotok)))}` })}` : ''}
            </span>
          </div>
          <span className={cn('text-[17px] font-bold', r.profit < 0 ? 'text-destructive' : 'text-success')}>
            {r.profit < 0 ? '−' : ''}৳{fmt(Math.abs(r.profit))}
          </span>
        </div>
      ))}
    </Card>
  )
}
