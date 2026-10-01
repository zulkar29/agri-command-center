import { ClipboardList, LandPlot, Sprout, SquarePlus, Trees } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Controller, useForm } from 'react-hook-form'
import { ChoiceChips } from '@/components/choice-chips'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { StatTile } from '@/components/stat-tile'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { fieldStage } from '@/lib/farm'
import { bn, toNum, whenLabel } from '@/lib/format'
import { obsKindLabel, zoneLabel } from '@/lib/labels'
import { ZONES } from '@/data/constants'
import { toneBar } from '@/lib/tone'
import { useCan } from '@/atoms/auth'
import { useFarm } from '@/atoms/farm'
import { useAddField, useAddObservation, useDeleteField, useFields, useObservations } from '@/services/fields'
import type { ObsKind } from '@/types'
import { FieldEdit } from './field-edit'
import { HarvestCard } from './harvest-card'
import { MarketPriceCard } from './market-price-card'
import { NextCrop } from './next-crop-card'

const OBS_KINDS = ['ঠিক আছে', 'পোকা', 'রোগ'] as const // values are the API's enum
const OBS_TONE = { 'ঠিক আছে': 'ok', পোকা: 'warn', রোগ: 'bad' } as const

interface FieldForm {
  name: string
  crop: string
  area: string
  plants: string
  harvest: string
  /** '' = not linked, else a zone index */
  zone: string
}

interface ObsForm {
  kind: ObsKind
  note: string
  /** '' = not tied to a field */
  fieldId: string
}

/** Empty number fields keep their defaults (0, or the given fallback). */
function numOr(v: string, fallback: number): number {
  const n = toNum(v)
  return Number.isNaN(n) ? fallback : n
}

export function FieldsPage() {
  const { t } = useTranslation()
  const fields = useFields()
  const observations = useObservations()
  const addField = useAddField()
  const deleteField = useDeleteField()
  const addObservation = useAddObservation()
  const can = useCan()
  const simulate = useFarm((s) => s.simulate)

  const fieldForm = useForm<FieldForm>({ defaultValues: { name: '', crop: '', area: '', plants: '', harvest: '', zone: '' } })
  const submitField = fieldForm.handleSubmit((v) => {
    addField.mutate({
      name: v.name.trim(),
      crop: v.crop.trim() || 'ফসল', // demo default crop name stays Bengali (data)
      area: numOr(v.area, 0),
      // whole numbers: the server's plants/harvestAt are integers (12.5 is a 400)
      plants: Math.round(numOr(v.plants, 0)),
      harvestAt: Math.max(1, Math.round(numOr(v.harvest, 75))),
      ...(v.zone !== '' ? { zone: Number(v.zone) } : {}),
    })
    fieldForm.reset()
  })

  const obsForm = useForm<ObsForm>({ defaultValues: { kind: 'ঠিক আছে', note: '', fieldId: '' } })
  const submitObs = obsForm.handleSubmit((v) => {
    addObservation.mutate({ kind: v.kind, note: v.note.trim(), ...(v.fieldId ? { fieldId: v.fieldId } : {}) })
    obsForm.reset()
  })

  return (
    <div className="flex flex-col gap-6">
      <section className="grid gap-4 sm:grid-cols-3">
        <StatTile icon={Sprout} tone="ok" label={t('nav.fields.label')} value={bn(fields.length)} />
        <StatTile icon={LandPlot} tone="info" label={t('fields.area')} value={bn(fields.reduce((a, f) => a + f.area, 0))} />
        <StatTile icon={Trees} tone="warn" label={t('fields.plants')} value={bn(fields.reduce((a, f) => a + f.plants, 0))} />
      </section>
      <section className="grid gap-6 lg:grid-cols-2">
        {fields.map((f) => {
          const st = fieldStage(f)
          return (
            <Card key={f.id}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex flex-col gap-0.5">
                  <CardTitle icon={Sprout}>{f.name}</CardTitle>
                  <span className="text-[13px] text-muted-foreground">
                    {f.crop} · {bn(f.area)} {t('units.shotok')} · {bn(f.plants)} {t('units.plants')}
                  </span>
                </div>
                <Badge tone={st.tone}>{st.label}</Badge>
              </div>
              <div className="flex flex-col gap-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm">{t('fields.plantAge', { n: bn(f.age) })}</span>
                  <span className="text-[13px] text-muted-foreground">{st.left}</span>
                </div>
                <Progress value={st.pct} indicatorClassName={toneBar[st.tone === 'neutral' ? 'ok' : st.tone]} aria-label={t('fields.progressLabel', { name: f.name })} />
              </div>
              {can('fields') ? (
                <div className="flex flex-wrap items-start gap-2">
                  {!simulate ? <FieldEdit field={f} /> : null}
                  <Button variant="danger" size="sm" onClick={() => deleteField.mutate(f)}>
                    {t('fields.deleteField')}
                  </Button>
                </div>
              ) : null}
              <NextCrop field={f} />
            </Card>
          )
        })}
        {fields.length === 0 ? (
          <Card>
            <p className="text-muted-foreground">{t('fields.noFields')}</p>
          </Card>
        ) : null}
      </section>

      <HarvestCard />

      <MarketPriceCard />

      <section className="grid gap-5 lg:grid-cols-2">
        {can('fields') ? (
        <Card>
          <CardTitle icon={SquarePlus}>{t('fields.addTitle')}</CardTitle>
          <form onSubmit={submitField} className="flex flex-col gap-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="f-name">{t('fields.name')}</Label>
                <Input
                  id="f-name"
                  placeholder={t('fields.namePlaceholder')}
                  {...fieldForm.register('name', { required: t('fields.nameRequired') })}
                />
                {fieldForm.formState.errors.name ? (
                  <p className="text-[13px] text-destructive">{fieldForm.formState.errors.name.message}</p>
                ) : null}
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="f-crop">{t('fields.crop')}</Label>
                <Input id="f-crop" placeholder={t('fields.cropPlaceholder')} {...fieldForm.register('crop')} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="f-area">{t('fields.area')}</Label>
                <Input id="f-area" inputMode="decimal" placeholder={bn(25)} {...fieldForm.register('area')} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="f-plants">{t('fields.plants')}</Label>
                <Input id="f-plants" inputMode="numeric" placeholder={bn(300)} {...fieldForm.register('plants')} />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="f-harvest">{t('fields.harvest')}</Label>
              <Input id="f-harvest" inputMode="numeric" placeholder={bn(75)} {...fieldForm.register('harvest')} />
            </div>
            <p className="text-[13px] text-muted-foreground">{t('fields.harvestNote')}</p>
            <Controller
              control={fieldForm.control}
              name="zone"
              render={({ field }) => (
                <ChoiceChips
                  value={field.value}
                  onChange={field.onChange}
                  options={[
                    { value: '', label: t('harvest.noZoneOption') },
                    ...ZONES.map((z, i) => ({ value: String(i), label: zoneLabel(z) })),
                  ]}
                  label={t('harvest.zoneLabel')}
                />
              )}
            />
            <div>
              <Button type="submit">{t('fields.addField')}</Button>
            </div>
          </form>
        </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle icon={ClipboardList}>{t('fields.scoutTitle')}</CardTitle>
            <CardDescription>{t('fields.scoutNote')}</CardDescription>
          </CardHeader>
          {can('scout') ? (
          <form onSubmit={submitObs} className="flex flex-col gap-4">
            <Controller
              control={obsForm.control}
              name="kind"
              render={({ field }) => (
                <ChoiceChips
                  value={field.value}
                  onChange={field.onChange}
                  options={OBS_KINDS.map((k) => ({ value: k, label: obsKindLabel(k) }))}
                  label={t('fields.whatSaw')}
                />
              )}
            />
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="obs-note">{t('fields.note')}</Label>
              <Input
                id="obs-note"
                placeholder={t('fields.notePlaceholder')}
                {...obsForm.register('note', { required: t('fields.noteRequired') })}
              />
              {obsForm.formState.errors.note ? (
                <p className="text-[13px] text-destructive">{obsForm.formState.errors.note.message}</p>
              ) : null}
            </div>
            {!simulate && fields.length > 0 ? (
              <Controller
                control={obsForm.control}
                name="fieldId"
                render={({ field }) => (
                  <ChoiceChips
                    value={field.value}
                    onChange={field.onChange}
                    options={[{ value: '', label: t('fields.obsNoField') }, ...fields.map((f) => ({ value: f.id, label: f.name }))]}
                    label={t('fields.obsField')}
                  />
                )}
              />
            ) : null}
            <div>
              <Button type="submit">{t('fields.writeNote')}</Button>
            </div>
          </form>
          ) : null}
          {observations.map((o) => (
            <div key={o.id} className="flex items-start gap-3 border-t py-3">
              <Badge tone={OBS_TONE[o.kind]}>{obsKindLabel(o.kind)}</Badge>
              <div className="flex min-w-0 flex-col">
                <span className="text-xs text-muted-foreground">{whenLabel(o.at)}</span>
                <span>{o.note}</span>
              </div>
            </div>
          ))}
        </Card>
      </section>
    </div>
  )
}
