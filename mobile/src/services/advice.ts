import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from '@/state/toast'
import i18n from '@/i18n'
import { useAtomValue } from 'jotai'
import { demoAtom } from '@/state/conn'
import type { Field, Task } from '@/lib/types'
import { http } from './http'

export interface Reason {
  factor: 'season' | 'rotation' | 'water' | 'market'
  /** 0..1 */
  score: number
  text: string
}

export interface Suggestion {
  cropId: string
  crop: string
  /** 0..100 */
  score: number
  /** strongest contribution first */
  reasons: Reason[]
}

function useLive() {
  return !useAtomValue(demoAtom)
}

const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : i18n.t('farm.serverSaveFailed'))

export function useRecommendations(fieldId: string, enabled: boolean) {
  const live = useLive()
  return useQuery({
    queryKey: ['recommendations', fieldId],
    queryFn: () => http.get<{ items: Suggestion[] }>(`/fields/${fieldId}/recommendations`).then((r) => r.items),
    enabled: live && enabled,
    retry: false,
  })
}

export function usePlantTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (x: { templateId: string; fieldId: string }) =>
      http.post<{ field: Field; tasks: Task[] }>(`/crop-templates/${x.templateId}/applications`, { fieldId: x.fieldId }),
    onSuccess: (r) => {
      toast.success(i18n.t('advice.planted', { crop: r.field.crop, n: r.tasks.length }))
      for (const key of ['fields', 'tasks', 'recommendations']) void qc.invalidateQueries({ queryKey: [key] })
    },
    onError: fail,
  })
}

