import { View } from 'react-native'
import { router } from 'expo-router'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { FieldProfitCard } from '@/components/field-profit-card'
import { Screen } from '@/components/screen'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardTitle } from '@/components/ui/card'
import { ChoiceChips } from '@/components/ui/chips'
import { Field, FieldError, Input } from '@/components/ui/input'
import { StatTile } from '@/components/ui/stat-tile'
import { AppText } from '@/components/ui/text'
import { EXPENSE_CATS, INCOME_CATS } from '@/lib/constants'
import { bn, fmt, toNum, whenLabel } from '@/lib/format'
import { catLabel } from '@/lib/labels'
import { C, R } from '@/lib/theme'
import { useTranslation } from 'react-i18next'
import { useFields } from '@/services/fields'
import { useAddLedger, useDeleteLedger, useLedger, useLedgerSummary } from '@/services/finance'
import { useCan } from '@/state/conn'

type Kind = 'expense' | 'income'
const KINDS = [
  { value: 'expense' as Kind, labelKey: 'finance.expense' },
  { value: 'income' as Kind, labelKey: 'finance.income' },
]

interface LedgerForm {
  type: Kind
  cat: string
  amount: string
  note: string
  /** '' = not tied to a field */
  fieldId: string
}

/** হিসাব: আয়, খরচ ও লাভের খাতা। */
export default function FinanceScreen() {
  const { t } = useTranslation()
  const ledger = useLedger()
  const addLedger = useAddLedger()
  const deleteLedger = useDeleteLedger()
  const can = useCan()
  const fields = useFields()

  const form = useForm<LedgerForm>({
    defaultValues: { type: 'expense', cat: EXPENSE_CATS[0], amount: '', note: '', fieldId: '' },
  })
  const type = useWatch({ control: form.control, name: 'type' })

  const submit = form.handleSubmit((v) => {
    addLedger.mutate({
      type: v.type,
      cat: v.cat,
      amount: toNum(v.amount),
      note: v.note.trim() || '—',
      ...(v.fieldId ? { fieldId: v.fieldId } : {}),
    })
    form.reset({ type: v.type, cat: v.cat, amount: '', note: '', fieldId: '' })
  })

  const { income, expense, expenseByCat: costMap } = useLedgerSummary()
  const profit = income - expense
  const plants = fields.reduce((a, f) => a + f.plants, 0)

  const maxCost = Math.max(1, ...Object.values(costMap))

  return (
    <Screen title={t('nav.finance.label')} sub={t('nav.finance.sub')} onBack={() => router.back()}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        <StatTile label={t('finance.totalIncome')} value={`৳ ${fmt(income)}`} note={t('finance.incomeNote')} />
        <StatTile label={t('finance.totalExpense')} value={`৳ ${fmt(expense)}`} note={t('finance.expenseNote')} />
        <StatTile
          label={t('finance.profitLoss')}
          value={`${profit < 0 ? '−' : ''}৳ ${fmt(Math.abs(profit))}`}
          note={profit < 0 ? t('finance.lossNote') : t('finance.profitNote')}
        />
        <StatTile
          label={t('finance.perPlant')}
          value={`৳ ${bn((expense / Math.max(1, plants)).toFixed(1))}`}
          note={t('finance.perPlantNote', { n: bn(plants) })}
        />
      </View>

      {can('finance') ? (
      <Card style={{ gap: 12 }}>
        <CardTitle>{t('finance.addTitle')}</CardTitle>
        <Field label={t('finance.kind')}>
          <Controller
            control={form.control}
            name="type"
            render={({ field: { value, onChange } }) => (
              <ChoiceChips
                value={value}
                onChange={(k) => {
                  onChange(k)
                  form.setValue('cat', k === 'income' ? INCOME_CATS[0] : EXPENSE_CATS[0])
                }}
                options={KINDS.map((k) => ({ value: k.value, label: t(k.labelKey) }))}
              />
            )}
          />
        </Field>
        <Field label={t('finance.category')}>
          <Controller
            control={form.control}
            name="cat"
            rules={{ required: t('finance.category') }}
            render={({ field: { value, onChange } }) => (
              <ChoiceChips
                value={value}
                onChange={onChange}
                options={(type === 'income' ? INCOME_CATS : EXPENSE_CATS).map((c) => ({ value: c, label: c }))}
              />
            )}
          />
        </Field>
        <Field label={t('finance.amount')}>
          <Controller
            control={form.control}
            name="amount"
            rules={{
              required: t('finance.amountRequired'),
              validate: (v) => toNum(v) > 0 || t('finance.amountRequired'),
            }}
            render={({ field: { value, onChange, onBlur } }) => (
              <Input
                value={value}
                onChangeText={onChange}
                onBlur={onBlur}
                inputMode="decimal"
                placeholder={t('finance.amountPlaceholder')}
                returnKeyType="done"
                onSubmitEditing={submit}
              />
            )}
          />
          {form.formState.errors.amount ? <FieldError>{form.formState.errors.amount.message}</FieldError> : null}
        </Field>
        <Field label={t('finance.note')}>
          <Controller
            control={form.control}
            name="note"
            render={({ field: { value, onChange, onBlur } }) => (
              <Input value={value} onChangeText={onChange} onBlur={onBlur} placeholder={t('finance.notePlaceholder')} />
            )}
          />
        </Field>
        {fields.length > 0 ? (
          <Field label={t('fieldProfit.field')}>
            <Controller
              control={form.control}
              name="fieldId"
              render={({ field: { value, onChange } }) => (
                <ChoiceChips
                  value={value}
                  onChange={onChange}
                  options={[{ value: '', label: t('fieldProfit.none') }, ...fields.map((f) => ({ value: f.id, label: f.name }))]}
                />
              )}
            />
          </Field>
        ) : null}
        <Button onPress={submit} busy={addLedger.isPending}>{t('finance.submit')}</Button>
      </Card>
      ) : null}

      <Card>
        <CardTitle>{t('finance.ledgerTitle')}</CardTitle>
        {ledger.length === 0 ? <AppText style={{ fontSize: 13, color: C.muted }}>{t('finance.empty')}</AppText> : null}
        {ledger.map((l) => (
          <View
            key={l.id}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: 1, borderTopColor: C.border, paddingTop: 10 }}
          >
            <View style={{ flex: 1, gap: 1 }}>
              <AppText weight="semi">{catLabel(l.cat)}</AppText>
              <AppText style={{ fontSize: 12.5, color: C.muted }}>
                {whenLabel(l.at)} · {l.note}
                {l.fieldId ? ` · ${fields.find((f) => f.id === l.fieldId)?.name ?? ''}` : ''}
              </AppText>
            </View>
            <AppText
              weight="bold"
              style={{ fontSize: 16, color: l.type === 'income' ? C.ok : 'rgba(23,35,29,0.8)' }}
            >
              {l.type === 'income' ? '+' : '−'}৳ {fmt(l.amount)}
            </AppText>
            {can('finance') ? (
              <Button variant="danger" size="sm" onPress={() => deleteLedger.mutate(l)}>
                {t('common.delete')}
              </Button>
            ) : null}
          </View>
        ))}
      </Card>

      <Card>
        <CardTitle>{t('finance.shareTitle')}</CardTitle>
        <CardDescription>{t('finance.shareNote')}</CardDescription>
        {Object.keys(costMap).length === 0 ? (
          <AppText style={{ fontSize: 13, color: C.muted }}>{t('finance.noExpenses')}</AppText>
        ) : (
          Object.entries(costMap).map(([name, value]) => (
            <View key={name} style={{ gap: 4 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <AppText style={{ fontSize: 13.5 }}>{name}</AppText>
                <AppText weight="semi" style={{ fontSize: 13.5 }}>৳ {fmt(value)}</AppText>
              </View>
              <View style={{ height: 8, borderRadius: 999, backgroundColor: '#e8ede7', overflow: 'hidden' }}>
                <View
                  style={{
                    width: `${(value / maxCost) * 100}%`,
                    height: '100%',
                    borderRadius: R.sm,
                    backgroundColor: C.info,
                  }}
                />
              </View>
            </View>
          ))
        )}
      </Card>

      <FieldProfitCard />
    </Screen>
  )
}
