import { useEffect } from 'react'
import { useFarm } from '@/atoms/farm'

/**
 * Demo simulation: while on, sensor values drift and the irrigation rules run every 2 seconds.
 * Turn it off in Settings once real devices send data.
 */
export function useSimulator() {
  const simulate = useFarm((s) => s.simulate)
  const tick = useFarm((s) => s.tick)
  useEffect(() => {
    if (!simulate) return
    const id = window.setInterval(tick, 2000)
    return () => window.clearInterval(id)
  }, [simulate, tick])
}
