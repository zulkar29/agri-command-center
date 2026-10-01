import { Wheat } from 'lucide-react'
import { Controller, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { ChoiceChips } from '@/components/choice-chips'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { bn, toNum, whenLabel } from '@/lib/format'
import { useAtomValue } from 'jotai'
import { currentUserAtom } from '@/atoms/auth'
import { useFarm } from '@/atoms/farm'
import { useFields } from '@/services/fields'
import { useAddHarvest, useDeleteHarvest, useEfficiency, useHarvests } from '@/services/harvest'

interface HarvestForm {
  /** '' = the first field */
  fieldId: string
  kg: string
  price: string
  income: boolean
}

/**
 * ফসল তোলা: record a picking (kg, price) per field and see litres per kg.
 * Live-only — harvest history lives on the server.
 */
export function HarvestCard() {
  const { t } = useTranslation()
  const simulate = useFarm((s) => s.simulate)
  const role = useAtomValue(currentUserAtom)?.role
  const fields = useFields()
  const harvests = useHarvests()
  const efficiency = useEfficiency()
  const add = useAddHarvest()
  const del = useDeleteHarvest()

  const form = useForm<HarvestForm>({ defaultValues: { fieldId: '', kg: '', price: '', income: false } })
  const canWrite = role === 'মালিক' || role === 'অপারেটর'
  const isOwner = role === 'মালিক'

  if (simulate) return null
  const fieldName = (id: string) => fields.find((f) => f.id === id)?.name ?? id
  const submit = form.handleSubmit((v) => {
    const price = toNum(v.price)
    add.mutate({
      fieldId: v.fieldId || fields[0]?.id || '',
      kg: toNum(v.kg),
      pricePerKg: Number.isNaN(price) ? 0 : price,
      addIncome: isOwner && v.income,
    })
    form.reset({ ...v, kg: '', price: '' })
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle icon={Wheat}>{t('harvest.title')}</CardTitle>
        <CardDescription>{t('harvest.note')}</CardDescription>
      </CardHeader>

      {efficiency.data && efficiency.data.length > 0 ? (
        <div className="flex flex-col gap-2">
          {efficiency.data.map((e) => (
            <div key={e.fieldId} className="flex flex-wrap items-baseline justify-between gap-2 border-t py-2 first:border-t-0">
              <span className="font-semibold">{e.name}</span>
              <span className="text-[13px] text-muted-foreground">
                {e.litresPerKg != null
                  ? t('harvest.litresPerKg', { n: bn(Math.round(e.litresPerKg)), kg: bn(Math.round(e.kg)) })
                  : e.zone == null
                    ? t('harvest.noZone')
                    : t('harvest.noData')}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {canWrite && fields.length > 0 ? (
        <form className="flex flex-col gap-3" onSubmit={submit} noValidate>
          <Controller
            control={form.control}
            name="fieldId"
            render={({ field }) => (
              <ChoiceChips
                value={field.value || fields[0]?.id || ''}
                onChange={field.onChange}
                options={fields.map((f) => ({ value: f.id, label: f.name }))}
                label={t('harvest.field')}
              />
            )}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="h-kg">{t('harvest.kg')}</Label>
              <Input id="h-kg" inputMode="decimal" aria-invalid={!!form.formState.errors.kg} {...form.register('kg', { validate: (v) => toNum(v) > 0 })} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="h-price">{t('harvest.price')}</Label>
              <Input id="h-price" inputMode="decimal" {...form.register('price')} />
            </div>
          </div>
          {isOwner ? (
            <label className="flex items-center gap-2 text-sm">
              <Controller
                control={form.control}
                name="income"
                render={({ field }) => <Checkbox checked={field.value} onCheckedChange={(v) => field.onChange(v === true)} />}
              />
              {t('harvest.addIncome')}
            </label>
          ) : null}
          <div>
            <Button type="submit" disabled={add.isPending}>
              {t('harvest.save')}
            </Button>
          </div>
        </form>
      ) : null}

      {(harvests.data ?? []).slice(0, 8).map((h) => (
        <div key={h.id} className="flex items-center justify-between gap-3 border-t py-3">
          <div className="flex min-w-0 flex-col">
            <span className="text-xs text-muted-foreground">{whenLabel(h.at)}</span>
            <span>
              {fieldName(h.fieldId)} · {bn(h.kg)} {t('harvest.kgUnit')}
              {h.pricePerKg > 0 ? ` · ৳${bn(h.pricePerKg)}/${t('harvest.kgUnit')}` : ''}
            </span>
          </div>
          {isOwner ? (
            <Button variant="danger" size="sm" onClick={() => del.mutate(h.id)}>
              {t('harvest.delete')}
            </Button>
          ) : null}
        </div>
      ))}
    </Card>
  )
}
