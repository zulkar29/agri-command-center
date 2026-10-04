import { useQuery } from '@tanstack/react-query'
import { http } from './http'

/** GET /api/v1/weather — Open-Meteo via the backend's 30-minute cache. */
export interface WeatherForecast {
  current: { temp: number; humidity: number; rain: number }
  daily: { date: string; rain: number }[]
  fetchedAt: number
}

export const weatherService = {
  get: () => http.get<WeatherForecast>('/weather'),
}

/** Live forecast for the overview card; enabled only while live (needs farm
 *  coordinates — the query answers 422 quietly until the owner sets them, 503 when the
 *  server has weather turned off). */
export function useWeather(enabled: boolean) {
  return useQuery({
    queryKey: ['weather'],
    queryFn: weatherService.get,
    enabled,
    retry: false,
    refetchInterval: 10 * 60_000,
    staleTime: 10 * 60_000,
  })
}
