import { atom, getDefaultStore, useAtomValue } from 'jotai'
import { atomWithStorage } from 'jotai/utils'
import { dueFor } from '@/lib/farm'
import { bn } from '@/lib/format'
import { createSeed } from '@/lib/seed'
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
} from '@/lib/types'
import i18n from '@/i18n'
import { farmService } from '@/services/farm'
import { jsonAsyncStorage } from './storage'
import { toast } from './toast'

const uid = () => Math.random().toString(16).slice(2, 10)
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
const pushLog = (log: LogEntry[], text: string): LogEntry[] =>
  [{ id: uid(), at: Date.now(), text }, ...log].slice(0, 20)

/**
 * The farm's whole data, persisted to AsyncStorage — this is the নমুনা মোড
 * store (dashboard/src/atoms/farm.ts keeps its twin in localStorage). With an
 * async storage the raw atom's value is `FarmData | Promise<FarmData>` until
 * hydration lands, so a resolved read atom with a synchronous cache sits on
 * top for actions and React.
 */
const farmStoredAtom = atomWithStorage<FarmData>(
  'farm-command-mobile-v1',
  createSeed(),
  jsonAsyncStorage<FarmData>(),
)

let farmCache: FarmData = createSeed()

export const farmDataAtom = atom((get) => {
  const v = get(farmStoredAtom)
  if (v instanceof Promise) return farmCache
  farmCache = v
  return v
})

function local(): FarmData {
  return store.get(farmDataAtom)
}

/**
 * What the UI shows: the server snapshot merged over the local store (local
 * `simulate` wins). Actions read this — never bare `local()` — so toggles
 * compute the right target state in live mode too.
 */
function cur(): FarmData {
  const snap = store.get(snapshotAtom)
  const base = local()
  return snap ? { ...base, ...snap, simulate: base.simulate } : base
}

/** Replace the whole local (নমুনা মোড) farm store. */
export function setLocal(data: FarmData) {
  farmCache = data
  store.set(farmStoredAtom, data)
}

const updateLocal = (patch: Partial<FarmData> | ((s: FarmData) => Partial<FarmData>)) => {
  const base = local()
  const next = typeof patch === 'function' ? patch(base) : patch
  setLocal({ ...base, ...next })
}

/**
 * Last server snapshot, runtime only. While a server is connected it is the
 * source of truth; when the connection drops the app keeps showing it.
 */
export const snapshotAtom = atom<FarmData | null>(null)

/** Backend connection state — runtime only, never persisted. */
export const liveAtom = atom(false)

const store = getDefaultStore()

/** Merge a server control snapshot over the local store (local `simulate`
 *  wins; demo collections survive — the snapshot no longer embeds them). */
export function hydrate(data: FarmSnapshot) {
  const { simulate: _serverSimulate, ...rest } = data
  store.set(snapshotAtom, rest as FarmData)
}

/** Await a server mutation and hydrate the snapshot the server returns. */
function runLive(p: Promise<FarmSnapshot>, okMsg?: string) {
  void p
    .then((data) => {
      hydrate(data)
      if (okMsg) toast.success(okMsg)
    })
    .catch((e: unknown) => toast.error(e instanceof Error ? e.message : i18n.t('farm.serverCmdFailed')))
}

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

const isLive = () => store.get(liveAtom)

/**
 * Control actions (pump, valves, mode, rules, notifications…) go to the API
 * first in live mode and hydrate the snapshot the server returns. Collection
 * actions (tasks, fields, observations, ledger, stock, schedules) are
 * demo-only — screens mutate those through the query hooks in src/services/.
 */
export const actions: FarmActions = {
  setFarmName: (farmName) => {
    if (isLive()) {
      runLive(farmService.update({ farmName }))
      return
    }
    updateLocal({ farmName })
  },
  setLat: (lat) => {
    if (isLive()) {
      runLive(farmService.update({ lat }))
      return
    }
    updateLocal({ lat })
  },
  setLng: (lng) => {
    if (isLive()) {
      runLive(farmService.update({ lng }))
      return
    }
    updateLocal({ lng })
  },
  setSimulate: (simulate) => updateLocal({ simulate }),
  resetDemo: () => {
    store.set(snapshotAtom, null)
    setLocal(createSeed())
    toast.success(i18n.t('farm.resetDemo'))
  },

  setMode: (mode) => {
    if (isLive()) {
      runLive(
        farmService.update({ mode }),
        mode === 'auto'
          ? i18n.t('farm.autoOn')
          : i18n.t('farm.manualOn'),
      )
      return
    }
    updateLocal({ mode, pumpOn: mode === 'auto' ? false : local().pumpOn })
    toast.info(
      mode === 'auto'
        ? i18n.t('farm.autoOn')
        : i18n.t('farm.manualOn'),
    )
  },
  togglePump: () => {
    const s = cur()
    const on = !s.pumpOn
    if (isLive()) {
      runLive(
        farmService.setPump(on ? 'on' : 'off'),
        on ? i18n.t('farm.pumpOn') : i18n.t('farm.pumpOff'),
      )
      return
    }
    updateLocal({
      pumpOn: on,
      mode: 'manual',
      irrLog: pushLog(s.irrLog, on ? 'পাম্প হাতে চালু' : 'পাম্প হাতে বন্ধ'),
    })
    toast.info(on ? i18n.t('farm.pumpOn') : i18n.t('farm.pumpOff'))
  },
  adjust: (key, delta) => {
    const s = cur()
    if (key === 'threshold') {
      const threshold = clamp(s.threshold + delta, 20, 60)
      if (isLive()) runLive(farmService.update({ threshold }))
      else updateLocal({ threshold })
    } else {
      const duration = clamp(s.duration + delta, 5, 60)
      if (isLive()) runLive(farmService.update({ duration }))
      else updateLocal({ duration })
    }
  },
  waterZones: (idxs, label) => {
    const s = cur()
    if (isLive()) {
      runLive(farmService.waterZones(idxs), i18n.t('farm.watered'))
      return
    }
    const open = idxs.filter((i) => s.valves[i])
    if (open.length === 0) {
      toast.error(i18n.t('farm.noWaterClosedValves'))
      return
    }
    updateLocal({
      moist: s.moist.map((v, i) => (open.includes(i) ? Math.min(75, v + 10) : v)),
      tank: Math.max(0, s.tank - 2 * open.length),
      irrLog: pushLog(s.irrLog, `হাতে সেচ · ${label} · ${bn(s.duration)} মিনিট`),
    })
    toast.success(i18n.t('farm.watered'))
  },
  fillTank: () => {
    const s = cur()
    if (isLive()) {
      runLive(farmService.fillTank(), i18n.t('farm.tankFilled'))
      return
    }
    updateLocal({ tank: Math.min(100, s.tank + 20), irrLog: pushLog(s.irrLog, i18n.t('farm.tankFilledLog')) })
    toast.success(i18n.t('farm.tankFilled'))
  },
  toggleValve: (i) => {
    const s = cur()
    const valves = s.valves.slice()
    valves[i] = !valves[i]
    if (isLive()) {
      runLive(farmService.update({ valves }))
      return
    }
    updateLocal({ valves })
  },
  toggleRule: (id) => {
    const s = cur()
    if (isLive()) {
      runLive(farmService.setRule(id, !(s.rules.find((r) => r.id === id)?.on ?? false)))
      return
    }
    updateLocal({ rules: s.rules.map((r) => (r.id === id ? { ...r, on: !r.on } : r)) })
  },
  addSchedule: (x) => {
    updateLocal({ schedules: [...local().schedules, { ...x, id: uid(), on: true }] })
    toast.success(i18n.t('toasts.scheduleAdded'))
  },
  toggleSchedule: (id) => {
    const s = cur()
    updateLocal({ schedules: s.schedules.map((x) => (x.id === id ? { ...x, on: !x.on } : x)) })
  },
  deleteSchedule: (id) => {
    updateLocal({ schedules: local().schedules.filter((x) => x.id !== id) })
    toast.info(i18n.t('toasts.scheduleDeleted'))
  },

  addField: (x) => {
    updateLocal({ fields: [...local().fields, { ...x, id: uid(), age: 0 }] })
    toast.success(i18n.t('toasts.fieldAdded'))
  },
  deleteField: (id) => {
    updateLocal({ fields: local().fields.filter((f) => f.id !== id) })
    toast.info(i18n.t('toasts.fieldDeleted'))
  },
  addObservation: (kind, note) => {
    updateLocal({ scout: [{ id: uid(), at: Date.now(), kind, note }, ...local().scout].slice(0, 30) })
    toast.success(i18n.t('toasts.noted'))
  },

  addTask: (x) => {
    updateLocal({ tasks: [{ ...x, id: uid(), done: false }, ...local().tasks] })
    toast.success(i18n.t('toasts.taskAdded'))
  },
  toggleTask: (id) => {
    const s = cur()
    const task = s.tasks.find((t) => t.id === id)
    const tasks = s.tasks.map((t) => (t.id === id ? { ...t, done: !t.done } : t))
    // like the server: finishing a repeating task creates the next one, repeatDays later
    if (task && !task.done && task.repeatDays) {
      const dueAt = Math.max(task.dueAt ?? 0, Date.now()) + task.repeatDays * 86_400_000
      tasks.unshift({ ...task, id: uid(), done: false, dueAt, due: dueFor(dueAt) })
    }
    updateLocal({ tasks })
  },
  deleteTask: (id) => {
    updateLocal({ tasks: local().tasks.filter((t) => t.id !== id) })
  },

  addLedger: (x) => {
    updateLocal({ ledger: [{ ...x, id: uid(), at: Date.now() }, ...local().ledger] })
    toast.success(i18n.t('toasts.ledgerAdded'))
  },
  deleteLedger: (id) => {
    updateLocal({ ledger: local().ledger.filter((l) => l.id !== id) })
  },

  adjustStock: (id, delta) => {
    updateLocal({ stock: local().stock.map((x) => (x.id === id ? { ...x, qty: Math.max(0, x.qty + delta) } : x)) })
  },
  addStock: (x) => {
    updateLocal({ stock: [...local().stock, { ...x, id: uid() }] })
    toast.success(i18n.t('toasts.stockAdded'))
  },
  deleteStock: (id) => {
    updateLocal({ stock: local().stock.filter((x) => x.id !== id) })
  },

  toggleNotif: (k) => {
    // cur(), not local(): in live mode the server snapshot holds the real settings
    const s = cur()
    const notif = { ...s.notif, [k]: !s.notif[k] }
    if (isLive()) {
      runLive(farmService.update({ notif }))
      return
    }
    updateLocal({ notif })
  },
  // live mode acknowledges server alerts through services/alerts.ts (PATCH /alerts/:id);
  // this store ack only covers the demo alerts
  ackAlert: (id) => {
    updateLocal({ ack: { ...local().ack, [id]: true } })
  },

  tick: () => {
    const s = cur()
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
    updateLocal({
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

/** The whole store the screens consume: data + actions + live flag, in one atom. */
export interface FarmStore extends FarmData, FarmActions {
  live: boolean
}

export const farmAtom = atom<FarmStore>((get) => {
  const base = get(farmDataAtom)
  const snap = get(snapshotAtom)
  const merged = snap ? { ...base, ...snap, simulate: base.simulate } : base
  return { ...merged, ...actions, live: get(liveAtom) }
})

/**
 * Same shape as the dashboard's hook: `useFarm()` for everything, or
 * `useFarm((s) => s.simulate)` for one slice.
 */
export function useFarm<T = FarmStore>(selector?: (s: FarmStore) => T): T {
  const s = useAtomValue(farmAtom)
  return (selector ? selector(s) : s) as T
}
