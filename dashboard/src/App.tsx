import { lazy, Suspense, type ComponentType, type ReactNode } from 'react'
import { useAtomValue } from 'jotai'
import { QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from '@/components/layout/app-shell'
import { Toaster } from '@/components/ui/sonner'
import { LoginPage } from '@/pages/login/login-page'
import { useSimulator } from '@/hooks/use-simulator'
import { useLiveFarm } from '@/services/farm'
import { authSessionAtom } from '@/atoms/auth'
import { useFarm } from '@/atoms/farm'
import { queryClient } from '@/lib/query-client'
import { NAV } from '@/lib/nav'
import type { ViewId } from '@/types'

// One chunk per page: the first visit to a route pays a
// small fetch, the entry bundle stays lean.
const PAGES: Record<ViewId, ComponentType> = {
  overview: lazy(() => import('@/pages/overview/overview-page').then((m) => ({ default: m.OverviewPage }))),
  irrigation: lazy(() => import('@/pages/irrigation/irrigation-page').then((m) => ({ default: m.IrrigationPage }))),
  fields: lazy(() => import('@/pages/fields/fields-page').then((m) => ({ default: m.FieldsPage }))),
  analytics: lazy(() => import('@/pages/analytics/analytics-page').then((m) => ({ default: m.AnalyticsPage }))),
  tasks: lazy(() => import('@/pages/tasks/tasks-page').then((m) => ({ default: m.TasksPage }))),
  finance: lazy(() => import('@/pages/finance/finance-page').then((m) => ({ default: m.FinancePage }))),
  reports: lazy(() => import('@/pages/reports/reports-page').then((m) => ({ default: m.ReportsPage }))),
  inventory: lazy(() => import('@/pages/inventory/inventory-page').then((m) => ({ default: m.InventoryPage }))),
  devices: lazy(() => import('@/pages/devices/devices-page').then((m) => ({ default: m.DevicesPage }))),
  settings: lazy(() => import('@/pages/settings/settings-page').then((m) => ({ default: m.SettingsPage }))),
}

/** Route-level loading shell — matches the page layout so nothing jumps. */
function PageFallback() {
  return <div className="min-h-40 animate-pulse rounded-xl bg-muted/50" aria-busy="true" />
}

/** Picks the data source: demo simulator while `simulate` is on, backend polling otherwise. */
function DataSources() {
  useSimulator()
  useLiveFarm()
  return null
}

/**
 * The app runs against the backend (নমুনা মোড off) only while logged in —
 * otherwise every route falls through to the login page. http.ts clears the
 * session on a 401, so an expired login lands here too.
 */
function RequireAuth({ children }: { children: ReactNode }) {
  const simulate = useFarm((s) => s.simulate)
  const session = useAtomValue(authSessionAtom)
  if (!simulate && !session) return <Navigate to="/login" replace />
  return <>{children}</>
}

/**
 * No jotai <Provider>: atoms run on the default store so module-level actions
 * (src/atoms/farm.ts — tick, hydrate, live commands) and the React tree share
 * one store. A Provider without a `store` prop would create a second one.
 */
export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <DataSources />
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<AppShell />}>
            <Route index element={<Navigate to="/overview" replace />} />
            {NAV.map((n) => {
              const Page = PAGES[n.id]
              return (
                <Route
                  key={n.id}
                  path={n.id}
                  element={
                    <RequireAuth>
                      <Suspense fallback={<PageFallback />}>
                        <Page />
                      </Suspense>
                    </RequireAuth>
                  }
                />
              )
            })}
            <Route path="*" element={<Navigate to="/overview" replace />} />
          </Route>
        </Routes>
        <Toaster />
      </BrowserRouter>
    </QueryClientProvider>
  )
}
