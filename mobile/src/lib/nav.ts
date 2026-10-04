import { router } from 'expo-router'
import type { ViewId } from './types'

const VIEW_ROUTE: Record<ViewId, string> = {
  overview: '/',
  irrigation: '/irrigation',
  fields: '/fields',
  analytics: '/analytics',
  tasks: '/tasks',
  finance: '/finance',
  inventory: '/inventory',
  devices: '/devices',
  settings: '/settings',
}

/** Navigate to a dashboard view id (typed routes are generated at build time). */
export function go(view: ViewId) {
  router.push(VIEW_ROUTE[view] as Parameters<typeof router.push>[0])
}
