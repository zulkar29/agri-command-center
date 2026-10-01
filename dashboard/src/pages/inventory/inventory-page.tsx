import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Boxes, Minus, Package, PackagePlus, Plus, ShoppingCart, Trash2, FileDown } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { StatTile } from '@/components/stat-tile'
import { Card, CardTitle } from '@/components/ui/card'
import { downloadCSV } from '@/lib/csv'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { isLowStock } from '@/lib/farm'
import { bn, toNum } from '@/lib/format'
import { useCan } from '@/atoms/auth'
import { useAtomValue } from 'jotai'
import { currentUserAtom } from '@/atoms/auth'
import { useFarm } from '@/atoms/farm'
import { ChoiceChips } from '@/components/choice-chips'
import { EXPENSE_CATS } from '@/data/constants'
import { catLabel } from '@/lib/labels'
import { useFields } from '@/services/fields'
import { useAddStock, useAdjustStock, useDeleteStock, useStock, useUseStock } from '@/services/inventory'
import type { StockItem } from '@/types'

interface StockForm {
  name: string
  qty: string
  unit: string
  min: string
}

/** Empty number fields keep their defaults (0, or the given fallback). */
function numOr(v: string, fallback: number): number {
  const n = toNum(v)
  return Number.isNaN(n) ? fallback : n
}

/** Inline form under a stock row: how much was used, on which field, at what cost. */
function UseStockForm({ item, onDone }: { item: StockItem; onDone: () => void }) {
  const { t } = useTranslation()
  const fields = useFields()
  const use = useUseStock()
  const isOwner = useAtomValue(currentUserAtom)?.role === 'মালিক'
  const [qty, setQty] = useState('')
  const [fieldId, setFieldId] = useState('')
  const [cost, setCost] = useState('')
  const [cat, setCat] = useState<string>(EXPENSE_CATS[0])
  const q = toNum(qty)
  const c = toNum(cost)
  const hasCost = isOwner && c > 0

  return (
    <form
      className="flex w-full basis-full flex-col gap-3 rounded-lg bg-muted/50 p-3"
      onSubmit={(ev) => {
        ev.preventDefault()
        if (!(q > 0)) return
        use.mutate(
          { id: item.id, qty: q, ...(fieldId ? { fieldId } : {}), ...(hasCost ? { cost: c, cat } : {}) },
          { onSuccess: onDone },
        )
      }}
    >
      <p className="text-[13px] text-muted-foreground">{t('inventory.useNote')}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`use-qty-${item.id}`}>{t('inventory.useQty', { unit: item.unit })}</Label>
          <Input id={`use-qty-${item.id}`} inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} />
        </div>
        {isOwner ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`use-cost-${item.id}`}>{t('inventory.useCost')}</Label>
            <Input id={`use-cost-${item.id}`} inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} />
          </div>
        ) : null}
      </div>
      {fields.length > 0 ? (
        <ChoiceChips
          value={fieldId}
          onChange={setFieldId}
          options={[{ value: '', label: t('tasks.noField') }, ...fields.map((f) => ({ value: f.id, label: f.name }))]}
          label={t('inventory.useField')}
        />
      ) : null}
      {hasCost ? (
        <ChoiceChips
          value={cat}
          onChange={setCat}
          options={EXPENSE_CATS.map((x) => ({ value: x as string, label: catLabel(x) }))}
          label={t('finance.category')}
        />
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={!(q > 0) || use.isPending}>
          {t('inventory.useSave')}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onDone}>
          {t('inventory.cancel')}
        </Button>
      </div>
    </form>
  )
}

export function InventoryPage() {
  const { t } = useTranslation()
  const stock = useStock()
  const live = !useFarm((s) => s.simulate)
  const [lowOnly, setLowOnly] = useState(false)
  const [using, setUsing] = useState<string | null>(null)
  const adjustStock = useAdjustStock()
  const addStock = useAddStock()
  const deleteStock = useDeleteStock()
  const can = useCan()
  const lowCount = stock.filter(isLowStock).length

  const form = useForm<StockForm>({ defaultValues: { name: '', qty: '', unit: '', min: '' } })
  const submit = form.handleSubmit((v) => {
    addStock.mutate({
      name: v.name.trim(),
      unit: v.unit.trim() || 'পিস', // demo default unit stays Bengali (data)
      qty: numOr(v.qty, 0),
      min: numOr(v.min, 0),
    })
    form.reset()
  })

  return (
    <div className="flex flex-col gap-6">
      <section className="grid gap-4 sm:grid-cols-3">
        <StatTile icon={Package} tone="info" label={t('inventory.title')} value={bn(stock.length)} />
        <StatTile
          icon={ShoppingCart}
          tone={lowCount ? 'warn' : 'ok'}
          label={t('inventory.shopping')}
          value={bn(lowCount)}
          note={lowCount ? t('inventory.low') : t('inventory.ok')}
        />
        <StatTile icon={Boxes} tone="ok" label={t('inventory.ok')} value={bn(stock.length - lowCount)} />
      </section>
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
        <CardTitle icon={Package}>{t('inventory.title')}</CardTitle>
        <div className="flex gap-2">
        <Button asChild variant="outline" size="sm">
            <Link to="/reports?doc=actions">
              <FileDown className="size-4" />
              {t('common.pdf')}
            </Link>
          </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            downloadCSV(
              'stock.csv',
              [t('inventory.name'), t('inventory.qty'), t('inventory.unit'), t('inventory.min')],
              stock.map((x) => [x.name, x.qty, x.unit, x.min]),
            )
          }
        >
          {t('common.csv')}
        </Button>
        <Button variant={lowOnly ? 'default' : 'outline'} size="sm" aria-pressed={lowOnly} onClick={() => setLowOnly((v) => !v)}>
          {lowOnly ? t('inventory.showAll') : t('inventory.shopping')}
        </Button>
        </div>
        </div>
        {stock.length === 0 ? <p className="text-[13px] text-muted-foreground">{t('inventory.empty')}</p> : null}
        {stock.filter((x) => !lowOnly || isLowStock(x)).map((x) => {
          const low = isLowStock(x)
          const step = x.qty >= 50 ? 10 : 1
          return (
            <div key={x.id} className="flex flex-wrap items-center gap-3 border-t py-3 first:border-t-0 first:pt-0">
              <div className="flex min-w-0 flex-1 basis-44 flex-col gap-1">
                <span className="font-semibold">{x.name}</span>
                <div className="flex items-center gap-2">
                  <Badge tone={low ? 'warn' : 'ok'}>{low ? t('inventory.low') : t('inventory.ok')}</Badge>
                  <span className="text-[13px] text-muted-foreground">
                    {t('inventory.minimum', { n: bn(x.min), unit: x.unit })}
                  </span>
                </div>
                {x.min > 0 ? (
                  <Progress
                    value={Math.min(100, (x.qty / (x.min * 3)) * 100)}
                    indicatorClassName={low ? 'bg-warning' : 'bg-success'}
                    aria-label={x.name}
                    className="mt-1 h-1.5 max-w-56"
                  />
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="icon" aria-label={t('inventory.decrease', { name: x.name })} disabled={!can('stock')} onClick={() => adjustStock.mutate({ id: x.id, delta: -step })}>
                  <Minus />
                </Button>
                <span className="min-w-[92px] text-center text-[17px] font-bold">
                  {bn(x.qty)} {x.unit}
                </span>
                <Button variant="outline" size="icon" aria-label={t('inventory.increase', { name: x.name })} disabled={!can('stock')} onClick={() => adjustStock.mutate({ id: x.id, delta: step })}>
                  <Plus />
                </Button>
              </div>
              {live && can('stockUse') ? (
                <Button variant="outline" size="sm" onClick={() => setUsing(using === x.id ? null : x.id)}>
                  {t('inventory.use')}
                </Button>
              ) : null}
              {can('stock') ? (
                <Button variant="ghost" size="icon" className="size-9 text-danger-ink hover:bg-danger-soft" onClick={() => deleteStock.mutate(x)} aria-label={t('inventory.deleteItem', { name: x.name })}>
                  <Trash2 className="size-[18px]" />
                </Button>
              ) : null}
              {using === x.id ? <UseStockForm item={x} onDone={() => setUsing(null)} /> : null}
            </div>
          )
        })}
      </Card>

      {can('stock') ? (
      <Card className="self-start">
        <CardTitle icon={PackagePlus}>{t('inventory.addTitle')}</CardTitle>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="stock-name">{t('inventory.name')}</Label>
            <Input
              id="stock-name"
              placeholder={t('inventory.namePlaceholder')}
              {...form.register('name', { required: t('inventory.nameRequired') })}
            />
            {form.formState.errors.name ? (
              <p className="text-[13px] text-destructive">{form.formState.errors.name.message}</p>
            ) : null}
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="stock-qty">{t('inventory.qty')}</Label>
              <Input
                id="stock-qty"
                inputMode="decimal"
                placeholder={bn(20)}
                {...form.register('qty', { validate: (v) => !Number.isNaN(toNum(v)) || t('inventory.qtyRequired') })}
              />
              {form.formState.errors.qty ? (
                <p className="text-[13px] text-destructive">{form.formState.errors.qty.message}</p>
              ) : null}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="stock-unit">{t('inventory.unit')}</Label>
              <Input id="stock-unit" placeholder={t('demo.kg')} {...form.register('unit')} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="stock-min">{t('inventory.min')}</Label>
              <Input id="stock-min" inputMode="decimal" placeholder={bn(5)} {...form.register('min')} />
            </div>
          </div>
          <div>
            <Button type="submit">{t('inventory.add')}</Button>
          </div>
        </form>
        <p className="text-[13px] text-muted-foreground">{t('inventory.lowNote')}</p>
      </Card>
      ) : null}
    </div>
    </div>
  )
}
