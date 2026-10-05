import { View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Controller, useForm } from 'react-hook-form'
import { HarvestCard } from '@/components/harvest-card'
import { NextCrop } from '@/components/next-crop'
import { Screen } from '@/components/screen'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardTitle } from '@/components/ui/card'
import { ChoiceChips } from '@/components/ui/chips'
import { Field, FieldError, Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { AppText } from '@/components/ui/text'
import { bn, toNum, whenLabel } from '@/lib/format'
import { fieldStage } from '@/lib/farm'
import { C } from '@/lib/theme'
import type { ObsKind } from '@/lib/types'
import { obsKindLabel } from '@/lib/labels'
import {
  useAddField,
  useAddObservation,
  useDeleteField,
  useFields,
  useObservations,
} from '@/services/fields'
import { useCan } from '@/state/conn'

const OBS_KINDS = ['ঠিক আছে', 'পোকা', 'রোগ'] as const
const OBS_TONE = { 'ঠিক আছে': 'ok', পোকা: 'warn', রোগ: 'bad' } as const

interface FieldForm {
  name: string
  crop: string
  area: string
  plants: string
  harvestAt: string
}

interface ObsForm {
  kind: ObsKind
  note: string
  /** '' = not tied to a field */
  fieldId: string
}

/** মাঠ ও ফসল: ফসলের ধাপ, ফসল তোলার হিসাব ও মাঠ পরিদর্শন। */
export default function FieldsScreen() {
  const { t } = useTranslation()
  const fields = useFields()
  const addField = useAddField()
  const deleteField = useDeleteField()
  const scout = useObservations()
  const addObservation = useAddObservation()
  const can = useCan()

  const fieldForm = useForm<FieldForm>({ defaultValues: { name: '', crop: '', area: '', plants: '', harvestAt: '' } })
  const add = fieldForm.handleSubmit((v) => {
    const a = toNum(v.area)
    const p = toNum(v.plants)
    const h = toNum(v.harvestAt)
    addField.mutate({
      name: v.name.trim(),
      crop: v.crop.trim() || 'ফসল',
      area: Number.isNaN(a) ? 0 : a,
      plants: Number.isNaN(p) ? 0 : Math.round(p),
      harvestAt: Number.isNaN(h) || h < 1 ? 75 : Math.round(h),
    })
    fieldForm.reset()
  })

  const obsForm = useForm<ObsForm>({ defaultValues: { kind: 'ঠিক আছে', note: '', fieldId: '' } })
  const addObs = obsForm.handleSubmit((v) => {
    addObservation.mutate({ kind: v.kind, note: v.note.trim(), ...(v.fieldId ? { fieldId: v.fieldId } : {}) })
    obsForm.reset()
  })

  return (
      <Screen title={t('nav.fields.label')} sub={t('nav.fields.sub')}>
      {fields.map((f) => {
        const st = fieldStage(f)
        return (
          <Card key={f.id}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
              <View style={{ flex: 1, gap: 2 }}>
                <AppText weight="semi" style={{ fontSize: 16 }}>{f.name}</AppText>
                <AppText style={{ fontSize: 13, color: C.muted }}>
                  {f.crop} · {bn(f.area)} {t('units.shotok')} · {bn(f.plants)} {t('units.plants')}
                </AppText>
              </View>
              <Badge t={st.tone}>{st.label}</Badge>
            </View>
            <View style={{ gap: 5 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <AppText style={{ fontSize: 14 }}>{t('fields.plantAge', { n: bn(f.age) })}</AppText>
                <AppText style={{ fontSize: 12.5, color: C.muted }}>{st.left}</AppText>
              </View>
              <Progress value={st.pct} t={st.tone === 'neutral' ? 'ok' : st.tone} />
            </View>
            {can('fields') ? (
              <Button variant="danger" size="sm" onPress={() => deleteField.mutate(f)} style={{ alignSelf: 'flex-start' }}>
                {t('fields.deleteField')}
              </Button>
            ) : null}
            <NextCrop field={f} />
          </Card>
        )
      })}
      {fields.length === 0 ? (
        <Card>
          <AppText style={{ color: C.muted }}>{t('fields.noFields')}</AppText>
        </Card>
      ) : null}

      <HarvestCard />

      {can('fields') ? (
      <Card style={{ gap: 12 }}>
        <CardTitle>{t('fields.addTitle')}</CardTitle>
        <Field label={t('fields.name')}>
          <Controller
            control={fieldForm.control}
            name="name"
            rules={{ required: t('fields.nameRequired') }}
            render={({ field: { value, onChange, onBlur } }) => (
              <Input
                value={value}
                onChangeText={onChange}
                onBlur={onBlur}
                placeholder={t('fields.namePlaceholder')}
                returnKeyType="done"
                onSubmitEditing={add}
              />
            )}
          />
          {fieldForm.formState.errors.name ? <FieldError>{fieldForm.formState.errors.name.message}</FieldError> : null}
        </Field>
        <Field label={t('fields.crop')}>
          <Controller
            control={fieldForm.control}
            name="crop"
            render={({ field: { value, onChange, onBlur } }) => (
              <Input value={value} onChangeText={onChange} onBlur={onBlur} placeholder={t('fields.cropPlaceholder')} />
            )}
          />
        </Field>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Field label={t('fields.area')}>
              <Controller
                control={fieldForm.control}
                name="area"
                render={({ field: { value, onChange, onBlur } }) => (
                  <Input value={value} onChangeText={onChange} onBlur={onBlur} inputMode="decimal" placeholder="২৫" />
                )}
              />
            </Field>
          </View>
          <View style={{ flex: 1 }}>
            <Field label={t('fields.plants')}>
              <Controller
                control={fieldForm.control}
                name="plants"
                render={({ field: { value, onChange, onBlur } }) => (
                  <Input value={value} onChangeText={onChange} onBlur={onBlur} inputMode="numeric" placeholder="৩০০" />
                )}
              />
            </Field>
          </View>
        </View>
        <Field label={t('fields.harvest')} hint={t('fields.harvestNote')}>
          <Controller
            control={fieldForm.control}
            name="harvestAt"
            render={({ field: { value, onChange, onBlur } }) => (
              <Input value={value} onChangeText={onChange} onBlur={onBlur} inputMode="numeric" placeholder="৭৫" />
            )}
          />
        </Field>
        <Button onPress={add} busy={addField.isPending}>{t('fields.addField')}</Button>
      </Card>
      ) : null}

      <Card style={{ gap: 12 }}>
        <CardTitle>{t('fields.scoutTitle')}</CardTitle>
        <CardDescription>{t('fields.scoutNote')}</CardDescription>
        {can('scout') ? (
          <>
        <Field label={t('fields.whatSaw')}>
          <Controller
            control={obsForm.control}
            name="kind"
            render={({ field: { value, onChange } }) => (
              <ChoiceChips value={value} onChange={onChange} options={OBS_KINDS.map((k) => ({ value: k, label: obsKindLabel(k) }))} />
            )}
          />
        </Field>
        <Field label={t('fields.note')}>
          <Controller
            control={obsForm.control}
            name="note"
            rules={{ required: t('fields.noteRequired') }}
            render={({ field: { value, onChange, onBlur } }) => (
              <Input
                value={value}
                onChangeText={onChange}
                onBlur={onBlur}
                placeholder={t('fields.notePlaceholder')}
                returnKeyType="done"
                onSubmitEditing={addObs}
              />
            )}
          />
          {obsForm.formState.errors.note ? <FieldError>{obsForm.formState.errors.note.message}</FieldError> : null}
        </Field>
        {fields.length > 0 ? (
          <Field label={t('fields.obsField')}>
            <Controller
              control={obsForm.control}
              name="fieldId"
              render={({ field: { value, onChange } }) => (
                <ChoiceChips
                  value={value}
                  onChange={onChange}
                  options={[{ value: '', label: t('fields.obsNoField') }, ...fields.map((f) => ({ value: f.id, label: f.name }))]}
                />
              )}
            />
          </Field>
        ) : null}
        <Button onPress={addObs} busy={addObservation.isPending}>{t('fields.writeNote')}</Button>
          </>
        ) : null}
        {scout.map((o) => (
          <View
            key={o.id}
            style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, borderTopWidth: 1, borderTopColor: C.border, paddingTop: 10 }}
          >
            <Badge t={OBS_TONE[o.kind]}>{obsKindLabel(o.kind)}</Badge>
            <View style={{ flex: 1, gap: 1 }}>
              <AppText style={{ fontSize: 12, color: C.muted }}>{whenLabel(o.at)}</AppText>
              <AppText>{o.note}</AppText>
            </View>
          </View>
        ))}
      </Card>
    </Screen>
  )
}
