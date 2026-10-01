import { ArrowDownLeft, FileDown, ArrowUpRight, ChartPie, Scale, Sprout, SquarePlus, Trash2, TrendingDown, TrendingUp, Wallet } from 'lucide-react'
import { useMemo } from 'react'
import type { EChartsCoreOption } from 'echarts/core'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { ChoiceChips } from '@/components/choice-chips'
import { EChart } from '@/components/echart'
import { CHART_COLORS, CHART_LEGEND, CHART_TOOLTIP } from '@/lib/chart-theme'
import { Button } from '@/components/ui/button'
import { StatTile } from '@/components/stat-tile'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { downloadCSV } from '@/lib/csv'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { EXPENSE_CATS, INCOME_CATS } from '@/data/constants'
import { bn, fmt, toNum, whenLabel } from '@/lib/format'
import { catLabel } from '@/lib/labels'
import { cn } from '@/lib/utils'
import { useCan } from '@/atoms/auth'
import { useFields } from '@/services/fields'
import { FieldProfitCard } from './field-profit-card'
import { useAddLedger, useDeleteLedger, useLedger, useLedgerSummary } from '@/services/finance'

type Kind = 'expense' | 'income'
const KINDS = [
  { value: 'expense', key: 'finance.expense' },
  { value: 'income', key: 'finance.income' },
] as const

interface LedgerForm {
  kind: Kind
  cat: string
  amount: string
  note: string
  /** '' = not tied to a field */
  fieldId: string
}

export function FinancePage() {
  const { t } = useTranslation()
  const ledger = useLedger()
  const addLedger = useAddLedger()
  const deleteLedger = useDeleteLedger()
  const fields = useFields()
  const can = useCan()

  const form = useForm<LedgerForm>({
    defaultValues: { kind: 'expense', cat: EXPENSE_CATS[0], amount: '', note: '', fieldId: '' },
  })
  const submit = form.handleSubmit((v) => {
    addLedger.mutate({
      type: v.kind,
      cat: v.cat,
      amount: toNum(v.amount),
      note: v.note.trim() || '—',
      ...(v.fieldId ? { fieldId: v.fieldId } : {}),
    })
    form.reset()
  })

  const { income, expense, expenseByCat: costMap } = useLedgerSummary()
  const profit = income - expense
  const plants = fields.reduce((a, f) => a + f.plants, 0)

  const donut = useMemo<EChartsCoreOption>(() => {
    const total = Object.values(costMap).reduce((a, b) => a + b, 0) || 1
    return {
      color: CHART_COLORS,
      tooltip: {
        ...CHART_TOOLTIP,
        trigger: 'item',
        formatter: (p: { name: string; value: number; color: string }) =>
          `<span style="color:${p.color}">●</span> ${p.name}<br/><b>৳ ${fmt(p.value)}</b> · ${bn(Math.round((p.value / total) * 100))}%`,
      },
      legend: { ...CHART_LEGEND, top: 'auto', bottom: 0, left: 'center' },
      series: [
        {
          name: t('finance.totalExpense'),
          type: 'pie',
          radius: ['58%', '80%'],
          center: ['50%', '44%'],
          padAngle: 2,
          avoidLabelOverlap: true,
          itemStyle: { borderColor: '#fff', borderWidth: 2, borderRadius: 8 },
          label: { show: false },
          emphasis: { scale: true, scaleSize: 6 },
          data: Object.entries(costMap)
            .sort((a, b) => b[1] - a[1])
            .map(([cat, value]) => ({ name: catLabel(cat), value })),
        },
      ],
    }
  }, [costMap, t])

  const tiles = [
    { label: t('finance.totalIncome'), value: `৳ ${fmt(income)}`, note: t('finance.incomeNote'), cls: '', icon: TrendingUp, tone: 'ok' as const },
    { label: t('finance.totalExpense'), value: `৳ ${fmt(expense)}`, note: t('finance.expenseNote'), cls: '', icon: TrendingDown, tone: 'warn' as const },
    {
      label: t('finance.profitLoss'),
      value: `${profit < 0 ? '−' : ''}৳ ${fmt(Math.abs(profit))}`,
      note: profit < 0 ? t('finance.lossNote') : t('finance.profitNote'),
      cls: profit < 0 ? 'text-destructive' : 'text-success',
      icon: Scale,
      tone: (profit < 0 ? 'bad' : 'ok') as 'bad' | 'ok',
    },
    { label: t('finance.perPlant'), value: `৳ ${bn((expense / Math.max(1, plants)).toFixed(1))}`, note: t('finance.perPlantNote', { n: bn(plants) }), cls: '', icon: Sprout, tone: 'info' as const },
  ]

  const kind = useWatch({ control: form.control, name: 'kind' })

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-wrap gap-3">
        {tiles.map((x) => (
          <StatTile key={x.label} icon={x.icon} tone={x.tone} label={x.label} value={x.value} note={x.note} valueClassName={x.cls} />
        ))}
      </section>

      <section className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card>
          <div className="flex items-center justify-between gap-3">
          <CardTitle icon={Wallet}>{t('finance.ledgerTitle')}</CardTitle>
          <div className="flex gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to="/reports?doc=pnl">
              <FileDown className="size-4" />
              {t('common.pdf')}
            </Link>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              downloadCSV(
                'ledger.csv',
                [t('finance.kind'), t('finance.category'), t('finance.amount'), t('finance.note'), t('finance.date')],
                ledger.map((l) => [t(l.type === 'income' ? 'finance.income' : 'finance.expense'), catLabel(l.cat), l.amount, l.note, whenLabel(l.at)]),
              )
            }
          >
            {t('common.csv')}
          </Button>
          </div>
          </div>
          {ledger.length === 0 ? <p className="text-[13px] text-muted-foreground">{t('finance.empty')}</p> : null}
          {ledger.map((l) => (
            <div key={l.id} className="flex flex-wrap items-center gap-3 border-t py-3 first:border-t-0 first:pt-0">
              <span
                className={cn(
                  'flex size-9 shrink-0 items-center justify-center rounded-full',
                  l.type === 'income' ? 'bg-success-soft text-success-ink' : 'bg-muted text-foreground/70',
                )}
              >
                {l.type === 'income' ? <ArrowDownLeft className="size-[18px]" /> : <ArrowUpRight className="size-[18px]" />}
              </span>
              <div className="flex min-w-0 flex-1 basis-48 flex-col gap-0.5">
                <span className="font-semibold">{catLabel(l.cat)}</span>
                <span className="text-[13px] text-muted-foreground">
                  {whenLabel(l.at)} · {l.note}
                  {l.fieldId ? ` · ${fields.find((f) => f.id === l.fieldId)?.name ?? ''}` : ''}
                </span>
              </div>
              <span className={cn('text-[17px] font-bold', l.type === 'income' ? 'text-success' : 'text-foreground/80')}>
                {l.type === 'income' ? '+' : '−'}৳ {fmt(l.amount)}
              </span>
              {can('finance') ? (
                <Button variant="ghost" size="icon" className="size-9 text-danger-ink hover:bg-danger-soft" onClick={() => deleteLedger.mutate(l)} aria-label={t('finance.deleteEntry', { cat: catLabel(l.cat) })}>
                  <Trash2 className="size-[18px]" />
                </Button>
              ) : null}
            </div>
          ))}
        </Card>

        <div className="flex flex-col gap-5">
          {can('finance') ? (
          <Card>
            <CardTitle icon={SquarePlus}>{t('finance.addTitle')}</CardTitle>
            <form onSubmit={submit} className="flex flex-col gap-4">
              <Controller
                control={form.control}
                name="kind"
                render={({ field }) => (
                  <ChoiceChips
                    value={field.value}
                    onChange={(v) => {
                      field.onChange(v)
                      form.setValue('cat', v === 'income' ? INCOME_CATS[0] : EXPENSE_CATS[0])
                    }}
                    options={KINDS.map((k) => ({ value: k.value, label: t(k.key) }))}
                    label={t('finance.kind')}
                  />
                )}
              />
              <div className="flex flex-col gap-1.5">
                <Label>{t('finance.category')}</Label>
                <Controller
                  control={form.control}
                  name="cat"
                  render={({ field }) => (
                    <ChoiceChips
                      value={field.value}
                      onChange={field.onChange}
                      options={(kind === 'income' ? INCOME_CATS : EXPENSE_CATS).map((c) => ({ value: c, label: catLabel(c) }))}
                      label={t('finance.category')}
                    />
                  )}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="amount">{t('finance.amount')}</Label>
                <Input
                  id="amount"
                  inputMode="decimal"
                  placeholder={t('finance.amountPlaceholder')}
                  {...form.register('amount', {
                    validate: (v) => {
                      const n = toNum(v)
                      return (!Number.isNaN(n) && n > 0) || t('finance.amountRequired')
                    },
                  })}
                />
                {form.formState.errors.amount ? (
                  <p className="text-[13px] text-destructive">{form.formState.errors.amount.message}</p>
                ) : null}
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ledger-note">{t('finance.note')}</Label>
                <Input id="ledger-note" placeholder={t('finance.notePlaceholder')} {...form.register('note')} />
              </div>
              {fields.length > 0 ? (
                <div className="flex flex-col gap-1.5">
                  <Label>{t('fieldProfit.field')}</Label>
                  <Controller
                    control={form.control}
                    name="fieldId"
                    render={({ field }) => (
                      <ChoiceChips
                        value={field.value}
                        onChange={field.onChange}
                        options={[{ value: '', label: t('fieldProfit.none') }, ...fields.map((f) => ({ value: f.id, label: f.name }))]}
                        label={t('fieldProfit.field')}
                      />
                    )}
                  />
                </div>
              ) : null}
              <div>
                <Button type="submit">{t('finance.submit')}</Button>
              </div>
            </form>
          </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle icon={ChartPie}>{t('finance.shareTitle')}</CardTitle>
              <CardDescription>{t('finance.shareNote')}</CardDescription>
            </CardHeader>
            {Object.keys(costMap).length === 0 ? (
              <p className="text-[13px] text-muted-foreground">{t('finance.noExpenses')}</p>
            ) : (
              <div className="relative">
                <EChart option={donut} label={t('finance.shareChartLabel')} height={280} />
                {/* the total in the ring's hole (center at 44% like the series) */}
                <div className="pointer-events-none absolute inset-x-0 top-[44%] flex -translate-y-1/2 flex-col items-center">
                  <span className="text-[12px] text-muted-foreground">{t('finance.totalExpense')}</span>
                  <span className="text-[20px] leading-tight font-bold">৳ {fmt(expense)}</span>
                </div>
              </div>
            )}
          </Card>

          <FieldProfitCard />
        </div>
      </section>
    </div>
  )
}
