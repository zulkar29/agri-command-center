import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import i18n from '@/i18n'
import { useFarm } from '@/atoms/farm'
import { farmService } from './farm'

/** Owner: the daily pump run-time cap (PATCH /farm maxDailyMinutes; 0 = no limit). */
export function useSetMaxDaily() {
  const hydrate = useFarm((s) => s.hydrate)
  return useMutation({
    mutationFn: (minutes: number) => farmService.update({ maxDailyMinutes: minutes }),
    onSuccess: (snapshot) => {
      hydrate(snapshot)
      toast.success(i18n.t('settings.maxDailySaved'))
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : i18n.t('farm.serverSaveFailed')),
  })
}
