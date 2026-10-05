import { useState } from 'react'
import { Pressable, View } from 'react-native'
import { useAtomValue } from 'jotai'
import { Ionicons } from '@expo/vector-icons'
import { router } from 'expo-router'
import { Controller, useForm } from 'react-hook-form'
import { Screen } from '@/components/screen'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardTitle } from '@/components/ui/card'
import { ChoiceChips } from '@/components/ui/chips'
import { Field, FieldError, Input } from '@/components/ui/input'
import { AppText } from '@/components/ui/text'
import { UNITS } from '@/lib/constants'
import { isLowStock } from '@/lib/farm'
import { bn, toNum } from '@/lib/format'
import { C, R } from '@/lib/theme'
import { useTranslation } from 'react-i18next'
import { UseStockForm } from '@/components/use-stock-form'
import { useAddStock, useAdjustStock, useDeleteStock, useStock } from '@/services/inventory'
import { demoAtom, useCan } from '@/state/conn'

interface StockForm {
  name: string
  unit: string
  qty: string
  min: string
}

/** মজুত: সার, কীটনাশক ও সরঞ্জাম কতটা আছে। */
export default function InventoryScreen() {
  const { t } = useTranslation()
  const stock = useStock()
  const adjustStock = useAdjustStock()
  const addStock = useAddStock()
  const deleteStock = useDeleteStock()
  const can = useCan()
  const live = !useAtomValue(demoAtom)
  const [lowOnly, setLowOnly] = useState(false)
  const [using, setUsing] = useState<string | null>(null)

  const form = useForm<StockForm>({ defaultValues: { name: '', unit: 'কেজি', qty: '', min: '' } })
  const add = form.handleSubmit((v) => {
    const q = toNum(v.qty)
    const m = toNum(v.min)
    addStock.mutate({
      name: v.name.trim(),
      unit: v.unit,
      qty: Number.isNaN(q) ? 0 : q,
      min: Number.isNaN(m) ? 0 : m,
    })
    form.reset({ name: '', unit: v.unit, qty: '', min: '' })
  })

  return (
    <Screen title={t('nav.inventory.label')} sub={t('nav.inventory.sub')} onBack={() => router.back()}>
      <Button variant="outline" onPress={() => setLowOnly((v) => !v)}>
        {lowOnly ? t('inventory.showAll') : t('inventory.shopping')}
      </Button>
      {stock.filter((x) => !lowOnly || isLowStock(x)).map((x) => {
        const low = isLowStock(x)
        return (
          <Card key={x.id}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <View style={{ flex: 1, gap: 2 }}>
                <AppText weight="semi" style={{ fontSize: 16 }}>{x.name}</AppText>
                <AppText style={{ fontSize: 12.5, color: C.muted }}>
                  {t('inventory.minimum', { n: bn(x.min), unit: x.unit })}
                </AppText>
              </View>
              {low ? <Badge t="warn">{t('inventory.low')}</Badge> : <Badge t="ok">{t('inventory.ok')}</Badge>}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <StepButton icon="remove" label={t('inventory.decrease', { name: x.name })} disabled={!can('stock')} onPress={() => adjustStock.mutate({ id: x.id, delta: -1 })} />
              <AppText weight="semi" style={{ fontSize: 16, minWidth: 56, textAlign: 'center' }}>
                {bn(x.qty)}
              </AppText>
              <StepButton icon="add" label={t('inventory.increase', { name: x.name })} disabled={!can('stock')} onPress={() => adjustStock.mutate({ id: x.id, delta: 1 })} />
              <View style={{ flex: 1 }} />
              {live && can('stockUse') ? (
                <Button variant="outline" onPress={() => setUsing(using === x.id ? null : x.id)}>
                  {t('inventory.use')}
                </Button>
              ) : null}
              {can('stock') ? (
              <Pressable
                onPress={() => deleteStock.mutate(x)}
                accessibilityLabel={t('inventory.deleteItem', { name: x.name })}
                hitSlop={8}
                style={({ pressed }) => ({
                  width: 36,
                  height: 36,
                  borderRadius: R.md,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: pressed ? C.badSoft : 'transparent',
                })}
              >
                <Ionicons name="trash-outline" size={18} color={C.bad} />
              </Pressable>
              ) : null}
            </View>
            {using === x.id ? <UseStockForm item={x} onDone={() => setUsing(null)} /> : null}
          </Card>
        )
      })}
      {stock.length === 0 ? (
        <Card>
          <AppText style={{ color: C.muted }}>{t('inventory.empty')}</AppText>
        </Card>
      ) : null}

      {can('stock') ? (
      <Card style={{ gap: 12 }}>
        <CardTitle>{t('inventory.addTitle')}</CardTitle>
        <Field label={t('inventory.name')}>
          <Controller
            control={form.control}
            name="name"
            rules={{ required: t('inventory.nameRequired') }}
            render={({ field: { value, onChange, onBlur } }) => (
              <Input
                value={value}
                onChangeText={onChange}
                onBlur={onBlur}
                placeholder={t('inventory.namePlaceholder')}
                returnKeyType="done"
                onSubmitEditing={add}
              />
            )}
          />
          {form.formState.errors.name ? <FieldError>{form.formState.errors.name.message}</FieldError> : null}
        </Field>
        <Field label={t('inventory.unit')}>
          <Controller
            control={form.control}
            name="unit"
            render={({ field: { value, onChange } }) => (
              <ChoiceChips value={value} onChange={onChange} options={UNITS.map((u) => ({ value: u, label: u }))} />
            )}
          />
        </Field>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Field label={t('inventory.qty')}>
              <Controller
                control={form.control}
                name="qty"
                render={({ field: { value, onChange, onBlur } }) => (
                  <Input value={value} onChangeText={onChange} onBlur={onBlur} inputMode="decimal" placeholder="২৫" />
                )}
              />
            </Field>
          </View>
          <View style={{ flex: 1 }}>
            <Field label={t('inventory.min')}>
              <Controller
                control={form.control}
                name="min"
                render={({ field: { value, onChange, onBlur } }) => (
                  <Input value={value} onChangeText={onChange} onBlur={onBlur} inputMode="decimal" placeholder="১০" />
                )}
              />
            </Field>
          </View>
        </View>
        <Button onPress={add} busy={addStock.isPending}>{t('inventory.add')}</Button>
      </Card>
      ) : null}
    </Screen>
  )
}

function StepButton({ icon, label, disabled, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={label}
      hitSlop={6}
      style={({ pressed }) => ({
        width: 36,
        height: 36,
        borderRadius: R.md,
        borderWidth: 1,
        borderColor: C.input,
        backgroundColor: pressed ? C.accent : C.card,
        alignItems: 'center',
        justifyContent: 'center',
      })}
    >
      <Ionicons name={icon} size={18} color={C.ink} />
    </Pressable>
  )
}
