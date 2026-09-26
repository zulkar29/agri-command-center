import { atom, getDefaultStore, useAtomValue } from 'jotai'
import { atomWithStorage } from 'jotai/utils'
import { toast } from 'sonner'
import { createSeed } from '@/data/seed'
import { dueFor } from '@/lib/farm'
import { bn } from '@/lib/format'
import i18n from '@/i18n'
import { farmService } from '@/services/farm'
import type {
  FarmSnapshot,
  Field,
  FarmData,
  LedgerEntry,
  LogEntry,
  Mode,
  NotifSettings,
  ObsKind,
  Schedule,
  StockItem,
  Task,
} from '@/types'

const uid = () => crypto.randomUUID().slice(0, 8)
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
const pushLog = (log: LogEntry[], text: string): LogEntry[] =>
  [{ id: uid(), at: Date.now(), text }, ...log].slice(0, 20)

/**
 * localStorage holds a plain FarmData object under 'farm-command-v1'. Older
 * builds (zustand persist) stored an envelope {state: ..., version: 1} —
 * unwrap those so existing demo data survives the jotai migration. Saved
 * values are merged over a fresh seed so fields added later keep a default.
 */
const farmStorage = {
  getItem: (key: string): FarmData => {
    try {
      const raw = localStorage.getItem(key)
      if (!raw) return createSeed()
      const parsed = JSON.parse(raw) as { state?: Partial<FarmData> } & Partial<FarmData>
      return { ...createSeed(), ...(parsed.state ?? parsed) }
    } catch {
      return createSeed()
    }
  },
  setItem: (key: string, value: FarmData) => localStorage.setItem(key, JSON.stringify(value)),
  removeItem: (key: string) => localStorage.removeItem(key),
}

/** The farm's whole data, persisted to localStorage. */
export const farmDataAtom = atomWithStorage<FarmData>('farm-command-v1', createSeed(), farmStorage, {
  getOnInit: true,
})

/** Backend connection state — runtime only, never persisted. */
export const liveAtom = atom(false)

export interface FarmActions {
  setFarmName: (name: string) => void
  setLat: (v: number) => void
  setLng: (v: number) => void
  setSimulate: (on: boolean) => void
  resetDemo: () => void

  setMode: (m: Mode) => void
  togglePump: () => void
  adjust: (key: 'threshold' | 'duration', delta: number) => void
  waterZones: (idxs: number[], label: string) => void
  fillTank: () => void
  toggleValve: (i: number) => void
  toggleRule: (id: string) => void
  addSchedule: (x: Omit<Schedule, 'id' | 'on'>) => void
  toggleSchedule: (id: string) => void
  deleteSchedule: (id: string) => void

  addField: (x: Omit<Field, 'id' | 'age'>) => void
  deleteField: (id: string) => void
  addObservation: (kind: ObsKind, note: string) => void

  addTask: (x: Omit<Task, 'id' | 'done'>) => void
  toggleTask: (id: string) => void
  deleteTask: (id: string) => void

  addLedger: (x: Omit<LedgerEntry, 'id' | 'at'>) => void
  deleteLedger: (id: string) => void

  adjustStock: (id: string, delta: number) => void
  addStock: (x: Omit<StockItem, 'id'>) => void
  deleteStock: (id: string) => void

  toggleNotif: (k: keyof NotifSettings) => void
  ackAlert: (id: string) => void
  /** one step of the demo simulation */
  tick: () => void
}

export interface FarmLive {
  /** a backend is connected and is the source of truth for actions */
  live: boolean
  setLive: (on: boolean) => void
  /** merge a server control snapshot over the local state (the simulate toggle
   *  stays local; demo collections survive — the snapshot no longer embeds them) */
  hydrate: (data: FarmSnapshot) => void
  /** await a server mutation and hydrate the snapshot it resolves to */
  runLive: (p: Promise<FarmSnapshot>, okMsg?: string) => void
}

export type FarmStore = FarmData & FarmActions & FarmLive

const store = getDefaultStore()
const get = () => store.get(farmDataAtom)
const update = (patch: Partial<FarmData> | ((s: FarmData) => Partial<FarmData>)) =>
  store.set(farmDataAtom, (s) => ({ ...s, ...(typeof patch === 'function' ? patch(s) : patch) }))
const isLive = () => store.get(liveAtom)

/**
 * Control actions (pump, valves, mode, rules…) keep the app consistent with a
 * real pump: when live they only change state after the server confirms.
 * Collection actions below them are the demo engine — while a backend is
 * connected, pages read and mutate collections through the query hooks in
 * src/services/ instead.
 */
const actions: Omit<FarmActions & FarmLive, 'live'> & { tick: () => void } = {
  hydrate: (data) => {
    const { simulate: _serverSimulate, ...rest } = data
    update(rest)
  },
  setLive: (on) => {
    if (store.get(liveAtom) !== on) store.set(liveAtom, on)
  },
  runLive: (p, okMsg) => {
    void p
      .then((data) => {
        actions.hydrate(data)
        if (okMsg) toast.success(okMsg)
      })
      .catch((e: unknown) => toast.error(e instanceof Error ? e.message : i18n.t('farm.serverCmdFailed')))
  },

  setFarmName: (farmName) => {
    if (isLive()) {
      actions.runLive(farmService.update({ farmName }))
      return
    }
    update({ farmName })
  },
  setLat: (lat) => {
    if (isLive()) {
      actions.runLive(farmService.update({ lat }))
      return
    }
    update({ lat })
  },
  setLng: (lng) => {
    if (isLive()) {
      actions.runLive(farmService.update({ lng }))
      return
    }
    update({ lng })
  },
  setSimulate: (simulate) => update({ simulate }),
  resetDemo: () => {
    store.set(farmDataAtom, createSeed())
    toast.success(i18n.t('farm.resetDemo'))
  },

  setMode: (mode) => {
    if (isLive()) {
      actions.runLive(
        farmService.update({ mode }),
        mode === 'auto' ? i18n.t('farm.autoOn') : i18n.t('farm.manualOn'),
      )
      return
    }
    update({ mode, pumpOn: mode === 'auto' ? false : get().pumpOn })
    toast(mode === 'auto' ? i18n.t('farm.autoOn') : i18n.t('farm.manualOn'))
  },
  togglePump: () => {
    const s = get()
    const on = !s.pumpOn
    if (isLive()) {
      actions.runLive(
        farmService.setPump(on ? 'on' : 'off'),
        on ? i18n.t('farm.pumpOn') : i18n.t('farm.pumpOff'),
      )
      return
    }
    update({ pumpOn: on, mode: 'manual', irrLog: pushLog(s.irrLog, on ? i18n.t('farm.pumpManualOn') : i18n.t('farm.pumpManualOff')) })
    toast(on ? i18n.t('farm.pumpOn') : i18n.t('farm.pumpOff'))
  },
  adjust: (key, delta) => {
    const s = get()
    if (key === 'threshold') {
      const threshold = clamp(s.threshold + delta, 20, 60)
      if (isLive()) actions.runLive(farmService.update({ threshold }))
      else update({ threshold })
    } else {
      const duration = clamp(s.duration + delta, 5, 60)
      if (isLive()) actions.runLive(farmService.update({ duration }))
      else update({ duration })
    }
  },
  waterZones: (idxs, label) => {
    const s = get()
    if (isLive()) {
      actions.runLive(farmService.waterZones(idxs), i18n.t('farm.watered'))
      return
    }
    const open = idxs.filter((i) => s.valves[i])
    if (open.length === 0) {
      toast.error(i18n.t('farm.noWaterClosedValves'))
      return
    }
    update({
      moist: s.moist.map((v, i) => (open.includes(i) ? Math.min(75, v + 10) : v)),
      tank: Math.max(0, s.tank - 2 * open.length),
      irrLog: pushLog(s.irrLog, `হাতে সেচ · ${label} · ${bn(s.duration)} মিনিট`),
    })
    toast.success(i18n.t('farm.watered'))
  },
  fillTank: () => {
    const s = get()
    if (isLive()) {
      actions.runLive(farmService.fillTank(), i18n.t('farm.tankFilled'))
      return
    }
    update({ tank: Math.min(100, s.tank + 20), irrLog: pushLog(s.irrLog, i18n.t('farm.tankFilledLog')) })
    toast.success(i18n.t('farm.tankFilled'))
  },
  toggleValve: (i) => {
    const s = get()
    const valves = s.valves.slice()
    valves[i] = !valves[i]
    if (isLive()) {
      actions.runLive(farmService.update({ valves }))
      return
    }
    update({ valves })
  },
  toggleRule: (id) => {
    const s = get()
    if (isLive()) {
      actions.runLive(farmService.setRule(id, !(s.rules.find((r) => r.id === id)?.on ?? false)))
      return
    }
    update({ rules: s.rules.map((r) => (r.id === id ? { ...r, on: !r.on } : r)) })
  },
  addSchedule: (x) => {
    update({ schedules: [...get().schedules, { ...x, id: uid(), on: true }] })
    toast.success(i18n.t('toasts.scheduleAdded'))
  },
  toggleSchedule: (id) => {
    update({ schedules: get().schedules.map((x) => (x.id === id ? { ...x, on: !x.on } : x)) })
  },
  deleteSchedule: (id) => {
    update({ schedules: get().schedules.filter((x) => x.id !== id) })
    toast(i18n.t('toasts.scheduleDeleted'))
  },

  addField: (x) => {
    update({ fields: [...get().fields, { ...x, id: uid(), age: 0 }] })
    toast.success(i18n.t('toasts.fieldAdded'))
  },
  deleteField: (id) => {
    update({ fields: get().fields.filter((f) => f.id !== id) })
    toast(i18n.t('toasts.fieldDeleted'))
  },
  addObservation: (kind, note) => {
    update({ scout: [{ id: uid(), at: Date.now(), kind, note }, ...get().scout].slice(0, 30) })
    toast.success(i18n.t('toasts.noted'))
  },

  addTask: (x) => {
    update({ tasks: [{ ...x, id: uid(), done: false }, ...get().tasks] })
    toast.success(i18n.t('toasts.taskAdded'))
  },
  toggleTask: (id) => {
    const tasks = get().tasks
    const task = tasks.find((t) => t.id === id)
    const next = tasks.map((t) => (t.id === id ? { ...t, done: !t.done } : t))
    // like the server: finishing a repeating task creates the next one, repeatDays later
    if (task && !task.done && task.repeatDays) {
      const dueAt = Math.max(task.dueAt ?? 0, Date.now()) + task.repeatDays * 86_400_000
      next.unshift({ ...task, id: uid(), done: false, dueAt, due: dueFor(dueAt) })
    }
    update({ tasks: next })
  },
  deleteTask: (id) => {
    update({ tasks: get().tasks.filter((t) => t.id !== id) })
  },

  addLedger: (x) => {
    update({ ledger: [{ ...x, id: uid(), at: Date.now() }, ...get().ledger] })
    toast.success(i18n.t('toasts.ledgerAdded'))
  },
  deleteLedger: (id) => {
    update({ ledger: get().ledger.filter((l) => l.id !== id) })
  },

  adjustStock: (id, delta) => {
    update({ stock: get().stock.map((x) => (x.id === id ? { ...x, qty: Math.max(0, x.qty + delta) } : x)) })
  },
  addStock: (x) => {
    update({ stock: [...get().stock, { ...x, id: uid() }] })
    toast.success(i18n.t('toasts.stockAdded'))
  },
  deleteStock: (id) => {
    update({ stock: get().stock.filter((x) => x.id !== id) })
  },

  toggleNotif: (k) => {
    const notif = { ...get().notif, [k]: !get().notif[k] }
    if (isLive()) {
      actions.runLive(farmService.update({ notif }))
      return
    }
    update({ notif })
  },
  // live mode acknowledges server alerts through services/alerts.ts (PATCH /alerts/:id);
  // this store ack only covers the demo alerts
  ackAlert: (id) => {
    update({ ack: { ...get().ack, [id]: true } })
  },

  tick: () => {
    const s = get()
    // While a server is connected its engine (backend/internal/engine) owns
    // the automation — the client simulator only drives নমুনা মোড.
    if (!s.simulate || isLive()) return
    const openIdx = s.valves.map((v, i) => (v ? i : -1)).filter((i) => i >= 0)
    const tankRule = s.rules.find((r) => r.id === 'r2')?.on ?? false
    let { pumpOn, tank, irrLog } = s
    let moist = s.moist.slice()

    if (s.mode === 'auto') {
      if (!pumpOn && openIdx.some((i) => moist[i] < s.threshold) && tank > 0 && !(tankRule && tank < 20)) {
        pumpOn = true
        irrLog = pushLog(irrLog, 'অটো সেচ শুরু · মাটি সীমার নিচে')
      } else if (pumpOn && openIdx.every((i) => moist[i] >= s.threshold + 12)) {
        pumpOn = false
        irrLog = pushLog(irrLog, 'অটো সেচ শেষ · আর্দ্রতা যথেষ্ট')
      }
    }
    if (pumpOn && tankRule && tank < 20) {
      pumpOn = false
      irrLog = pushLog(irrLog, 'ট্যাংক কম, পাম্প বন্ধ')
      toast.warning(i18n.t('farm.tankLowPumpOff'))
    }
    if (pumpOn) {
      openIdx.forEach((i) => {
        moist[i] = Math.min(75, moist[i] + 1.2)
      })
      tank = Math.max(0, tank - 0.4)
      if (tank <= 0) pumpOn = false
    } else {
      moist = moist.map((v) => Math.max(5, v - 0.06))
    }
    const walk = (x: number, range: number, lo: number, hi: number) =>
      clamp(x + (Math.random() - 0.5) * range, lo, hi)
    update({
      pumpOn,
      tank,
      moist,
      irrLog,
      humidity: walk(s.humidity, 0.6, 55, 95),
      temp: walk(s.temp, 0.2, 18, 38),
      volt: walk(s.volt, 0.04, 11.8, 13.6),
    })
  },
}

/** The whole store the pages consume: data + actions + live flag, in one atom. */
export const farmAtom = atom<FarmStore>((get) => ({
  ...get(farmDataAtom),
  ...actions,
  live: get(liveAtom),
}))

/**
 * Same shape as the old zustand hook: `useFarm()` for everything, or
 * `useFarm((s) => s.simulate)` for one slice.
 */
export function useFarm<T = FarmStore>(selector?: (s: FarmStore) => T): T {
  const s = useAtomValue(farmAtom)
  return (selector ? selector(s) : s) as T
}
