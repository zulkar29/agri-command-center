import { useEffect, useState } from 'react'
import { Bell, Menu } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { SidebarContent } from '@/components/layout/sidebar'
import { useFarmAlerts } from '@/services/alerts'
import { bn } from '@/lib/format'
import { NAV } from '@/lib/nav'
import { cn } from '@/lib/utils'
import { useFarm } from '@/atoms/farm'

export function AppShell() {
  const [open, setOpen] = useState(false)
  const { t, i18n } = useTranslation()
  const state = useFarm()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const view = pathname.replace(/^\//, '')
  const meta = NAV.find((n) => n.id === view) ?? NAV[0]
  const Icon = meta.icon
  const { items: alertItems } = useFarmAlerts()
  const alertCount = alertItems.length

  useEffect(() => {
    document.title = `${t(meta.label)} · ${t('app.name')}`
  }, [t, meta.label, i18n.language])

  const status = state.simulate
    ? { label: t('shell.demoData'), dot: 'bg-gold', box: 'border-warning-line bg-warning-soft text-warning-ink' }
    : state.live
      ? { label: t('shell.live'), dot: 'bg-success animate-pulse', box: 'border-success-line bg-success-soft text-success-ink' }
      : { label: t('shell.noServer'), dot: 'bg-destructive', box: 'border-danger-line bg-danger-soft text-danger-ink' }

  return (
    <div className="flex min-h-svh">
      <aside className="sticky top-0 hidden h-svh w-64 shrink-0 lg:block">
        <SidebarContent />
      </aside>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent title={t('app.mainMenu')}>
          <SidebarContent onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 border-b bg-background/85 backdrop-blur">
          <div className="mx-auto flex w-full max-w-[1320px] items-center justify-between gap-3 px-4 py-3.5 sm:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <Button variant="outline" size="icon" className="lg:hidden" aria-label={t('app.openMenu')} onClick={() => setOpen(true)}>
                <Menu className="size-5" />
              </Button>
              <span className="hidden size-11 shrink-0 items-center justify-center rounded-xl bg-accent text-primary sm:flex">
                <Icon className="size-5" />
              </span>
              <div className="flex min-w-0 flex-col">
                <h1 className="truncate text-xl leading-tight font-bold sm:text-2xl">{t(meta.label)}</h1>
                <span className="truncate text-[13px] text-muted-foreground">{t(meta.sub)}</span>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className={cn('hidden items-center gap-2 rounded-full border px-3 py-1.5 text-[13px] font-semibold sm:inline-flex', status.box)}>
                <span className={cn('size-2 rounded-full', status.dot)} />
                {status.label}
              </span>
              <Button
                variant="outline"
                size="icon"
                className="relative"
                aria-label={t('shell.alerts', { n: bn(alertCount) })}
                onClick={() => navigate('/overview')}
              >
                <Bell className="size-[18px]" />
                {alertCount > 0 ? (
                  <span className="absolute -top-1 -right-1 min-w-[20px] rounded-full bg-destructive px-1 text-center text-[11px] leading-5 font-bold text-white">
                    {bn(alertCount)}
                  </span>
                ) : null}
              </Button>
            </div>
          </div>
        </header>
        <main className="mx-auto flex w-full max-w-[1320px] flex-1 flex-col gap-6 p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
