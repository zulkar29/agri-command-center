import { Controller, useForm, useWatch } from 'react-hook-form'
import { View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useAtomValue } from 'jotai'
import { Button } from '@/components/ui/button'
import { ChoiceChips } from '@/components/ui/chips'
import { Field, Input } from '@/components/ui/input'
import { AppText } from '@/components/ui/text'
import { EXPENSE_CATS } from '@/lib/constants'
import { toNum } from '@/lib/format'
import { catLabel } from '@/lib/labels'
import { C, R } from '@/lib/theme'
import type { StockItem } from '@/lib/types'
import { useFields } from '@/services/fields'
import { useUseStock } from '@/services/inventory'
import { authSessionAtom } from '@/state/conn'

/** Under a stock row: how much was used, on which field, at what cost (live only). */
export function UseStockForm({ item, onDone }: { item: StockItem; onDone: () => void }) {
  const { t } = useTranslation()
  const fields = useFields()
  const use = useUseStock()
  const isOwner = useAtomValue(authSessionAtom)?.user.role === 'মালিক'
  const { control, handleSubmit } = useForm<{ qty: string; fieldId: string; cost: string; cat: string }>({
    defaultValues: { qty: '', fieldId: '', cost: '', cat: EXPENSE_CATS[0] },
  })
  const q = toNum(useWatch({ control, name: 'qty' }))
  const costNum = toNum(useWatch({ control, name: 'cost' }))
  const hasCost = isOwner && costNum > 0

  return (
    <View style={{ gap: 10, backgroundColor: C.secondary, borderRadius: R.md, padding: 12 }}>
      <AppText style={{ fontSize: 12.5, color: C.muted }}>{t('inventory.useNote')}</AppText>
      <Field label={t('inventory.useQty', { unit: item.unit })}>
        <Controller control={control} name="qty" render={({ field }) => <Input value={field.value} onChangeText={field.onChange} keyboardType="decimal-pad" />} />
      </Field>
      {isOwner ? (
        <Field label={t('inventory.useCost')}>
          <Controller control={control} name="cost" render={({ field }) => <Input value={field.value} onChangeText={field.onChange} keyboardType="decimal-pad" />} />
        </Field>
      ) : null}
      {fields.length > 0 ? (
        <Field label={t('inventory.useField')}>
          <Controller
            control={control}
            name="fieldId"
            render={({ field }) => (
              <ChoiceChips
                value={field.value}
                onChange={field.onChange}
                options={[{ value: '', label: t('tasks.noField') }, ...fields.map((f) => ({ value: f.id, label: f.name }))]}
              />
            )}
          />
        </Field>
      ) : null}
      {hasCost ? (
        <Field label={t('finance.category')}>
          <Controller
            control={control}
            name="cat"
            render={({ field }) => (
              <ChoiceChips value={field.value} onChange={field.onChange} options={EXPENSE_CATS.map((x) => ({ value: x as string, label: catLabel(x) }))} />
            )}
          />
        </Field>
      ) : null}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button
          busy={use.isPending}
          disabled={!(q > 0)}
          onPress={() =>
            void handleSubmit((v) =>
              use.mutate(
                { id: item.id, qty: toNum(v.qty), ...(v.fieldId ? { fieldId: v.fieldId } : {}), ...(hasCost ? { cost: toNum(v.cost), cat: v.cat } : {}) },
                { onSuccess: onDone },
              ),
            )()
          }
        >
          {t('inventory.useSave')}
        </Button>
        <Button variant="outline" onPress={onDone}>
          {t('inventory.cancel')}
        </Button>
      </View>
    </View>
  )
}
