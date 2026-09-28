import {
  ChartColumn,
  Cpu,
  Droplets,
  FileText,
  LayoutDashboard,
  ListChecks,
  Package,
  Settings,
  Sprout,
  Wallet,
  type LucideIcon,
} from 'lucide-react'
import type { ViewId } from '@/types'

export interface NavItem {
  id: ViewId
  /** i18n keys — the label/sub text lives in src/i18n/{bn,en}.json */
  label: string
  sub: string
  icon: LucideIcon
  group: NavGroup
}

export type NavGroup = 'monitor' | 'farm' | 'system'

/** Sidebar sections, in order; titles are i18n keys `nav.groups.<id>`. */
export const NAV_GROUPS: NavGroup[] = ['monitor', 'farm', 'system']

export const NAV: NavItem[] = [
  { id: 'overview', label: 'nav.overview.label', sub: 'nav.overview.sub', icon: LayoutDashboard, group: 'monitor' },
  { id: 'irrigation', label: 'nav.irrigation.label', sub: 'nav.irrigation.sub', icon: Droplets, group: 'monitor' },
  { id: 'analytics', label: 'nav.analytics.label', sub: 'nav.analytics.sub', icon: ChartColumn, group: 'monitor' },
  { id: 'fields', label: 'nav.fields.label', sub: 'nav.fields.sub', icon: Sprout, group: 'farm' },
  { id: 'tasks', label: 'nav.tasks.label', sub: 'nav.tasks.sub', icon: ListChecks, group: 'farm' },
  { id: 'inventory', label: 'nav.inventory.label', sub: 'nav.inventory.sub', icon: Package, group: 'farm' },
  { id: 'finance', label: 'nav.finance.label', sub: 'nav.finance.sub', icon: Wallet, group: 'farm' },
  { id: 'reports', label: 'nav.reports.label', sub: 'nav.reports.sub', icon: FileText, group: 'farm' },
  { id: 'devices', label: 'nav.devices.label', sub: 'nav.devices.sub', icon: Cpu, group: 'system' },
  { id: 'settings', label: 'nav.settings.label', sub: 'nav.settings.sub', icon: Settings, group: 'system' },
]

/** Navigation is handled by react-router (see App.tsx); NAV ids double as route paths, e.g. /irrigation. */
