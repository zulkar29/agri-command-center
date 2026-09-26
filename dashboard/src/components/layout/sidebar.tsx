import { Leaf, LogOut } from 'lucide-react'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { NavLink } from 'react-router-dom'
import { isLowStock } from '@/lib/farm'
import { bn } from '@/lib/format'
import { roleLabel } from '@/lib/labels'
import { NAV, NAV_GROUPS } from '@/lib/nav'
import { cn } from '@/lib/utils'
import { useFarmAlerts } from '@/services/alerts'
import { useLogout } from '@/services/auth'
import { useFields } from '@/services/fields'
import { useStock } from '@/services/inventory'
import { useTasks } from '@/services/tasks'
import { authSessionAtom } from '@/atoms/auth'
import { useFarm } from '@/atoms/farm'
import type { ViewId } from '@/types'

export function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useTranslation()
  const state = useFarm()
  const session = useAtomValue(authSessionAtom)
  const logoutMutation = useLogout()
  const { items: alertItems } = useFarmAlerts()
  // the dual-source hooks: server lists while live, the demo store otherwise
  const tasks = useTasks()
  const stock = useStock()
  const fields = useFields()
  const badges: Partial<Record<ViewId, number>> = {
    overview: alertItems.length,
    tasks: tasks.filter((x) => !x.done && x.due === 'আজ').length,
    inventory: stock.filter(isLowStock).length,
  }
  const area = fields.reduce((a, f) => a + f.area, 0)
  const user = session?.user

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto bg-sidebar p-4 text-sidebar-foreground">
      <div className="flex items-center gap-3 px-1.5 pt-1">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gold text-sidebar">
          <Leaf className="size-5" strokeWidth={2.4} />
        </span>
        <div className="flex flex-col">
          <span className="text-[17px] leading-tight font-bold text-white">{t('app.name')}</span>
          <span className="text-xs text-sidebar-muted">{t('app.tagline')}</span>
        </div>
      </div>

      <div className="flex flex-col gap-1 rounded-xl border border-sidebar-border bg-white/[0.04] px-3.5 py-3">
        <span className="flex items-center gap-1.5 text-[11px] tracking-wide text-sidebar-muted uppercase">
          <span className={cn('size-1.5 rounded-full', state.simulate ? 'bg-gold' : state.live ? 'bg-emerald-400' : 'bg-red-400')} />
          {t('app.yourFarm')}
        </span>
        <span className="font-semibold text-white">{state.farmName}</span>
        <span className="text-[13px] text-sidebar-muted">
          {t('app.farmStats', { area: bn(area), plants: bn(fields.reduce((a, f) => a + f.plants, 0)), fields: bn(fields.length) })}
        </span>
      </div>

      <nav aria-label={t('app.mainMenu')} className="flex flex-1 flex-col gap-5">
        {NAV_GROUPS.map((g) => (
          <div key={g} className="flex flex-col gap-0.5">
            <span className="px-3 pb-1.5 text-[11px] font-semibold tracking-wider text-sidebar-muted uppercase">
              {t(`nav.groups.${g}`)}
            </span>
            {NAV.filter((n) => n.group === g).map((n) => {
              const badge = badges[n.id] ?? 0
              const Icon = n.icon
              return (
                <NavLink
                  key={n.id}
                  to={`/${n.id}`}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    cn(
                      'group relative flex h-10 w-full items-center gap-3 rounded-lg px-3 text-[15px] font-medium transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-gold/50',
                      isActive ? 'bg-sidebar-active font-semibold text-white' : 'hover:bg-white/[0.06] hover:text-white',
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      {isActive ? <span className="absolute inset-y-2 left-0 w-[3px] rounded-r bg-gold" /> : null}
                      <Icon className={cn('size-[18px] shrink-0', isActive ? 'text-gold' : 'text-sidebar-muted group-hover:text-white')} />
                      <span className="flex-1">{t(n.label)}</span>
                      {badge > 0 ? (
                        <span className="min-w-[22px] rounded-full bg-gold px-1.5 py-px text-center text-xs font-bold text-sidebar">
                          {bn(badge)}
                        </span>
                      ) : null}
                    </>
                  )}
                </NavLink>
              )
            })}
          </div>
        ))}
      </nav>

      {user ? (
        <div className="flex items-center gap-3 rounded-xl border border-sidebar-border bg-white/[0.04] p-2.5">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-sidebar-active font-bold text-gold">
            {user.name.trim().charAt(0).toUpperCase()}
          </span>
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm font-semibold text-white">{user.name}</span>
            <span className="text-xs text-sidebar-muted">{roleLabel(user.role)}</span>
          </div>
          <button
            type="button"
            onClick={() => logoutMutation.mutate()}
            aria-label={t('settings.logout')}
            className="flex size-8 items-center justify-center rounded-md text-sidebar-muted transition-colors outline-none hover:bg-white/10 hover:text-white focus-visible:ring-[3px] focus-visible:ring-gold/50"
          >
            <LogOut className="size-4" />
          </button>
        </div>
      ) : (
        <p className="px-1 text-xs leading-relaxed text-sidebar-muted">{t('app.openSourceNote')}</p>
      )}
    </div>
  )
}
