import { useState } from 'react'
import { View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useAtomValue } from 'jotai'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { AppText } from '@/components/ui/text'
import { bn } from '@/lib/format'
import { C, R } from '@/lib/theme'
import type { Field, Tone } from '@/lib/types'
import { usePlantTemplate, useRecommendations } from '@/services/advice'
import { demoAtom, useCan } from '@/state/conn'

const reasonTone = (score: number): Tone => (score >= 0.7 ? 'ok' : score >= 0.4 ? 'neutral' : 'warn')

/**
 * "What next on this field": the server ranks the crops by season, rotation,
 * water and market price and says why. The farmer decides; the owner can plant
 * the choice, which sets the crop and adds its dated jobs (live only).
 */
export function NextCrop({ field }: { field: Field }) {
  const { t } = useTranslation()
  const demo = useAtomValue(demoAtom)
  const can = useCan()
  const [open, setOpen] = useState(false)
  const [confirm, setConfirm] = useState<string | null>(null)
  const advice = useRecommendations(field.id, open)
  const plant = usePlantTemplate()
  if (demo) return null

  const top = (advice.data ?? []).slice(0, 3)
  return (
    <View style={{ gap: 10, borderTopWidth: 1, borderTopColor: C.border, paddingTop: 10 }}>
      <Button variant="outline" size="sm" onPress={() => setOpen((v) => !v)} style={{ alignSelf: 'flex-start' }}>
        {open ? t('advice.hide') : t('advice.show')}
      </Button>
      {open ? (
        <>
          <AppText style={{ fontSize: 12.5, color: C.muted }}>{t('advice.note')}</AppText>
          {advice.isLoading ? <AppText style={{ fontSize: 13, color: C.muted }}>{t('common.loading')}</AppText> : null}
          {top.map((s) => (
            <View key={s.cropId} style={{ gap: 8, borderWidth: 1, borderColor: C.border, borderRadius: R.md, padding: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <AppText weight="semi">{s.crop}</AppText>
                <Badge t={s.score >= 70 ? 'ok' : 'neutral'}>{t('advice.score', { n: bn(s.score) })}</Badge>
              </View>
              {s.reasons.slice(0, 3).map((r) => (
                <View key={r.factor} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
                  <Badge t={reasonTone(r.score)}>{bn(Math.round(r.score * 100))}</Badge>
                  <AppText style={{ flex: 1, fontSize: 13, lineHeight: 18 }}>{r.text}</AppText>
                </View>
              ))}
              {can('fields') ? (
                confirm === s.cropId ? (
                  <View style={{ gap: 8 }}>
                    <AppText style={{ fontSize: 12.5, color: C.muted }}>{t('advice.plantNote')}</AppText>
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <Button
                        size="sm"
                        busy={plant.isPending}
                        onPress={() => plant.mutate({ templateId: s.cropId, fieldId: field.id }, { onSuccess: () => setConfirm(null) })}
                      >
                        {t('advice.plant')}
                      </Button>
                      <Button size="sm" variant="outline" onPress={() => setConfirm(null)}>
                        {t('fields.cancel')}
                      </Button>
                    </View>
                  </View>
                ) : (
                  <Button size="sm" variant="outline" onPress={() => setConfirm(s.cropId)} style={{ alignSelf: 'flex-start' }}>
                    {t('advice.plant')}
                  </Button>
                )
              ) : null}
            </View>
          ))}
        </>
      ) : null}
    </View>
  )
}
