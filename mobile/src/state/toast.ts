import { atom, getDefaultStore } from 'jotai'

export type ToastKind = 'success' | 'error' | 'warning' | 'info'

export interface ToastItem {
  id: number
  kind: ToastKind
  msg: string
}

export const toastsAtom = atom<ToastItem[]>([])

let nextId = 1

function push(kind: ToastKind, msg: string) {
  const store = getDefaultStore()
  const id = nextId++
  store.set(toastsAtom, (xs) => [...xs.slice(-2), { id, kind, msg }])
  setTimeout(() => {
    store.set(toastsAtom, (xs) => xs.filter((t) => t.id !== id))
  }, 3500)
}

/** Minimal stand-in for the dashboard's sonner toasts. */
export const toast = {
  success: (msg: string) => push('success', msg),
  error: (msg: string) => push('error', msg),
  warning: (msg: string) => push('warning', msg),
  info: (msg: string) => push('info', msg),
}
