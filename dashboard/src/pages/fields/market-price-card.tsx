import { Tag } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { bn, toNum, whenLabel } from '@/lib/format'
import { useAtomValue } from 'jotai'
import { currentUserAtom } from '@/atoms/auth'
import { useFarm } from '@/atoms/farm'
import { useAddMarketPrice, useDeleteMarketPrice, useMarketPrices } from '@/services/advice'

interface PriceForm {
  crop: string
  price: string
  market: string
}

/** The owner's price book — what a crop fetched, per kg. It feeds the next-crop advice (live only). */
export function MarketPriceCard() {
  const { t } = useTranslation()
  const simulate = useFarm((s) => s.simulate)
  const isOwner = useAtomValue(currentUserAtom)?.role === 'মালিক'
  const prices = useMarketPrices().data ?? []
  const add = useAddMarketPrice()
  const del = useDeleteMarketPrice()
  const form = useForm<PriceForm>({ defaultValues: { crop: '', price: '', market: '' } })
  if (simulate) return null

  const submit = form.handleSubmit((v) =>
    add.mutate(
      { crop: v.crop.trim(), pricePerKg: toNum(v.price), ...(v.market.trim() ? { market: v.market.trim() } : {}) },
      { onSuccess: () => form.reset() },
    ),
  )
  const bad = form.formState.errors
  return (
    <Card>
      <CardHeader>
        <CardTitle icon={Tag}>{t('advice.priceTitle')}</CardTitle>
        <CardDescription>{t('advice.priceNote')}</CardDescription>
      </CardHeader>
      {isOwner ? (
        <form className="flex flex-col gap-3" onSubmit={submit} noValidate>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="mp-crop">{t('advice.priceCrop')}</Label>
              <Input id="mp-crop" aria-invalid={!!bad.crop} {...form.register('crop', { validate: (v) => v.trim() !== '' })} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="mp-price">{t('advice.pricePerKg')}</Label>
              <Input id="mp-price" inputMode="decimal" aria-invalid={!!bad.price} {...form.register('price', { validate: (v) => toNum(v) > 0 })} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="mp-market">{t('advice.priceMarket')}</Label>
              <Input id="mp-market" {...form.register('market')} />
            </div>
          </div>
          <div>
            <Button type="submit" disabled={add.isPending}>
              {t('advice.priceAdd')}
            </Button>
          </div>
        </form>
      ) : null}
      {prices.length === 0 ? <p className="text-[13px] text-muted-foreground">{t('advice.priceEmpty')}</p> : null}
      {prices.map((r) => (
        <div key={r.id} className="flex items-center justify-between gap-3 border-t py-2.5">
          <div className="flex min-w-0 flex-col">
            <span>
              {r.crop} · ৳{bn(r.pricePerKg)}/{t('harvest.kgUnit')}
            </span>
            <span className="text-xs text-muted-foreground">
              {whenLabel(r.at)}
              {r.market ? ` · ${r.market}` : ''}
            </span>
          </div>
          {isOwner ? (
            <Button variant="danger" size="sm" onClick={() => del.mutate(r.id)}>
              {t('common.delete')}
            </Button>
          ) : null}
        </div>
      ))}
    </Card>
  )
}
