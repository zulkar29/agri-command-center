import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { bn } from '@/lib/format'
import { useFarm } from '@/atoms/farm'
import { useCan } from '@/atoms/auth'
import { usePlantTemplate, useRecommendations, type Suggestion } from '@/services/advice'
import type { Field } from '@/types'

const REASON_TONE = (score: number) => (score >= 0.7 ? 'ok' : score >= 0.4 ? 'neutral' : 'warn')

/**
 * "What next on this field": the server ranks the crops by season, rotation,
 * water and market price (internal/recommend) and says why. The farmer decides;
 * the owner can plant the choice, which sets the crop and adds its dated jobs.
 */
export function NextCrop({ field }: { field: Field }) {
  const { t } = useTranslation()
  const simulate = useFarm((s) => s.simulate)
  const can = useCan()
  const [open, setOpen] = useState(false)
  const [confirm, setConfirm] = useState<string | null>(null)
  const advice = useRecommendations(field.id, open)
  const plant = usePlantTemplate()
  if (simulate) return null

  const top: Suggestion[] = (advice.data ?? []).slice(0, 3)
  return (
    <div className="flex flex-col gap-3 border-t pt-3">
      <div>
        <Button variant="outline" size="sm" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? t('advice.hide') : t('advice.show')}
        </Button>
      </div>
      {open ? (
        <>
          <p className="text-[13px] text-muted-foreground">{t('advice.note')}</p>
          {advice.isLoading ? <p className="text-[13px] text-muted-foreground">{t('common.loading')}</p> : null}
          {advice.isError ? <p className="text-[13px] text-destructive">{t('common.loadFailed')}</p> : null}
          {top.map((s) => (
            <div key={s.cropId} className="flex flex-col gap-2 rounded-lg border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold">{s.crop}</span>
                <Badge tone={s.score >= 70 ? 'ok' : 'neutral'}>{t('advice.score', { n: bn(s.score) })}</Badge>
              </div>
              <ul className="flex flex-col gap-1">
                {s.reasons.slice(0, 3).map((r) => (
                  <li key={r.factor} className="flex items-start gap-2 text-[13px]">
                    <Badge tone={REASON_TONE(r.score)}>{bn(Math.round(r.score * 100))}</Badge>
                    <span className="leading-snug">{r.text}</span>
                  </li>
                ))}
              </ul>
              {can('fields') ? (
                confirm === s.cropId ? (
                  <div className="flex flex-col gap-2">
                    <p className="text-[13px] text-muted-foreground">{t('advice.plantNote')}</p>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        disabled={plant.isPending}
                        onClick={() => plant.mutate({ templateId: s.cropId, fieldId: field.id }, { onSuccess: () => setConfirm(null) })}
                      >
                        {t('advice.plant')}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setConfirm(null)}>
                        {t('fields.cancel')}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <Button size="sm" variant="outline" onClick={() => setConfirm(s.cropId)}>
                      {t('advice.plant')}
                    </Button>
                  </div>
                )
              ) : null}
            </div>
          ))}
        </>
      ) : null}
    </div>
  )
}
