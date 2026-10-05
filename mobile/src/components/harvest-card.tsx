import { Controller, useForm, useWatch } from 'react-hook-form'
import { View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useAtomValue } from 'jotai'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardTitle } from '@/components/ui/card'
import { ChoiceChips } from '@/components/ui/chips'
import { Field, Input } from '@/components/ui/input'
import { AppSwitch } from '@/components/ui/switch'
import { AppText } from '@/components/ui/text'
import { bn, toNum, whenLabel } from '@/lib/format'
import { C } from '@/lib/theme'
import { useFields } from '@/services/fields'
import { useAddHarvest, useDeleteHarvest, useEfficiency, useHarvests } from '@/services/harvest'
import { authSessionAtom, demoAtom } from '@/state/conn'

/**
 * ফসল তোলা: record a picking (kg, price) per field and see litres per kg.
 * Live-only — harvest history lives on the server.
 */
export function HarvestCard() {
  const { t } = useTranslation()
  const demo = useAtomValue(demoAtom)
  const role = useAtomValue(authSessionAtom)?.user.role
  const fields = useFields()
  const harvests = useHarvests()
  const efficiency = useEfficiency()
  const add = useAddHarvest()
  const del = useDeleteHarvest()

  const { control, handleSubmit, reset } = useForm<{ fieldId: string; kg: string; price: string; income: boolean }>({
    defaultValues: { fieldId: '', kg: '', price: '', income: false },
  })
  const pickedField = useWatch({ control, name: 'fieldId' })
  const kgText = useWatch({ control, name: 'kg' })
  const canWrite = role === 'মালিক' || role === 'অপারেটর'
  const isOwner = role === 'মালিক'

  if (demo) return null
  const selected = pickedField || fields[0]?.id || ''
  const kgNum = toNum(kgText)
  const fieldName = (id: string) => fields.find((f) => f.id === id)?.name ?? id

  return (
    <Card style={{ gap: 12 }}>
      <CardTitle>{t('harvest.title')}</CardTitle>
      <CardDescription>{t('harvest.note')}</CardDescription>

      {(efficiency.data ?? []).map((e) => (
        <View
          key={e.fieldId}
          style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 6, borderTopWidth: 1, borderTopColor: C.border, paddingTop: 8 }}
        >
          <AppText weight="semi">{e.name}</AppText>
          <AppText style={{ fontSize: 12.5, color: C.muted }}>
            {e.litresPerKg != null
              ? t('harvest.litresPerKg', { n: bn(Math.round(e.litresPerKg)), kg: bn(Math.round(e.kg)) })
              : e.zone == null
                ? t('harvest.noZone')
                : t('harvest.noData')}
          </AppText>
        </View>
      ))}

      {canWrite && fields.length > 0 ? (
        <View style={{ gap: 10 }}>
          <Field label={t('harvest.field')}>
            <Controller
              control={control}
              name="fieldId"
              render={({ field }) => (
                <ChoiceChips value={selected} onChange={field.onChange} options={fields.map((f) => ({ value: f.id, label: f.name }))} />
              )}
            />
          </Field>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Field label={t('harvest.kg')}>
                <Controller control={control} name="kg" render={({ field }) => <Input value={field.value} onChangeText={field.onChange} keyboardType="decimal-pad" />} />
              </Field>
            </View>
            <View style={{ flex: 1 }}>
              <Field label={t('harvest.price')}>
                <Controller control={control} name="price" render={({ field }) => <Input value={field.value} onChangeText={field.onChange} keyboardType="decimal-pad" />} />
              </Field>
            </View>
          </View>
          {isOwner ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <AppText style={{ flex: 1 }}>{t('harvest.addIncome')}</AppText>
              <Controller control={control} name="income" render={({ field }) => <AppSwitch value={field.value} onValueChange={field.onChange} />} />
            </View>
          ) : null}
          <Button
            busy={add.isPending}
            disabled={!(kgNum > 0)}
            onPress={() =>
              void handleSubmit((v) => {
                const priceNum = toNum(v.price)
                add.mutate({
                  fieldId: selected,
                  kg: toNum(v.kg),
                  pricePerKg: Number.isNaN(priceNum) ? 0 : priceNum,
                  addIncome: isOwner && v.income,
                })
                reset({ ...v, kg: '', price: '' })
              })()
            }
          >
            {t('harvest.save')}
          </Button>
        </View>
      ) : null}

      {(harvests.data ?? []).slice(0, 8).map((h) => (
        <View
          key={h.id}
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, borderTopWidth: 1, borderTopColor: C.border, paddingTop: 10 }}
        >
          <View style={{ flex: 1, gap: 1 }}>
            <AppText style={{ fontSize: 12, color: C.muted }}>{whenLabel(h.at)}</AppText>
            <AppText>
              {fieldName(h.fieldId)} · {bn(h.kg)} {t('harvest.kgUnit')}
              {h.pricePerKg > 0 ? ` · ৳${bn(h.pricePerKg)}/${t('harvest.kgUnit')}` : ''}
            </AppText>
          </View>
          {isOwner ? (
            <Button variant="danger" size="sm" onPress={() => del.mutate(h.id)}>
              {t('harvest.delete')}
            </Button>
          ) : null}
        </View>
      ))}
    </Card>
  )
}
