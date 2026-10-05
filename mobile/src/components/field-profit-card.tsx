import { View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useAtomValue } from 'jotai'
import { Card, CardDescription, CardTitle } from '@/components/ui/card'
import { AppText } from '@/components/ui/text'
import { fmt } from '@/lib/format'
import { C } from '@/lib/theme'
import { useFieldProfit } from '@/services/reports'
import { demoAtom } from '@/state/conn'

/** Income, expense and profit per field, from the ledger entries tagged with it (live only). */
export function FieldProfitCard() {
  const { t } = useTranslation()
  const demo = useAtomValue(demoAtom)
  const rows = useFieldProfit().data ?? []
  if (demo) return null

  return (
    <Card>
      <CardTitle>{t('fieldProfit.title')}</CardTitle>
      <CardDescription>{t('fieldProfit.note')}</CardDescription>
      {rows.map((r) => (
        <View
          key={r.fieldId || 'untagged'}
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, borderTopWidth: 1, borderTopColor: C.border, paddingTop: 10 }}
        >
          <View style={{ flex: 1, gap: 1 }}>
            <AppText weight="semi">{r.fieldId ? r.name : t('fieldProfit.untagged')}</AppText>
            <AppText style={{ fontSize: 12.5, color: C.muted }}>
              +৳{fmt(r.income)} · −৳{fmt(r.expense)}
              {r.profitPerShotok != null
                ? ` · ${t('fieldProfit.perShotok', { n: `${r.profitPerShotok < 0 ? '−' : ''}৳${fmt(Math.abs(Math.round(r.profitPerShotok)))}` })}`
                : ''}
            </AppText>
          </View>
          <AppText weight="bold" style={{ fontSize: 16, color: r.profit < 0 ? C.bad : C.ok }}>
            {r.profit < 0 ? '−' : ''}৳{fmt(Math.abs(r.profit))}
          </AppText>
        </View>
      ))}
    </Card>
  )
}
