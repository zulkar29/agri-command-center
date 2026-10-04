import type { DeviceStatus, FarmData } from './types'

const H = 3_600_000
const D = 24 * H
const now = Date.now()

/**
 * Demo dataset for নমুনা মোড — the same rows the backend seeds on first boot
 * (backend/internal/db/seed.go), so both clients look alike out of the box.
 */
export function createSeed(): FarmData {
  return {
    farmName: 'আমার সবজি বাগান',
    simulate: true,
    mode: 'auto',
    pumpOn: false,
    threshold: 35,
    duration: 20,
    moist: [44, 38, 31],
    valves: [true, true, true],
    tank: 68,
    humidity: 78,
    temp: 28,
    volt: 12.6,
    ack: {},
    rules: [
      { id: 'r1', text: 'কাল বৃষ্টির সম্ভাবনা ৬০% এর বেশি হলে সেচ বাদ দাও', on: true },
      { id: 'r2', text: 'ট্যাংক ২০% এর নিচে নামলে পাম্প বন্ধ করো', on: true },
      { id: 'r3', text: 'সন্ধ্যা ৬টা থেকে ভোর ৫টা পর্যন্ত পাম্প চালিও না', on: false },
      { id: 'r4', text: 'সেন্সর ৩০ মিনিট সাড়া না দিলে সতর্কতা পাঠাও', on: true },
    ],
    schedules: [
      { id: 's1', time: '07:00', dur: 20, zone: 'সব জোন', on: true },
      { id: 's2', time: '16:30', dur: 15, zone: 'জোন গ', on: false },
    ],
    irrLog: [
      { id: 'l1', at: now - 2 * H, text: 'অটো সেচ · সব জোন · ২০ মিনিট' },
      { id: 'l2', at: now - D - 2 * H, text: 'অটো সেচ · সব জোন · ২০ মিনিট' },
      { id: 'l3', at: now - 3 * D, text: 'হাতে সেচ · জোন গ · ১০ মিনিট' },
    ],
    fields: [
      { id: 'field-tomato', name: 'টমেটো বাগান', crop: 'টমেটো', area: 25, plants: 300, age: 52, harvestAt: 75 , zone: 0 },
      { id: 'field-brinjal', name: 'নমুনা: বেগুনের সারি', crop: 'বেগুন', area: 5, plants: 60, age: 20, harvestAt: 80 , zone: 2 },
    ],
    scout: [
      { id: 'o1', at: now - D, kind: 'ঠিক আছে', note: 'জোন ক-এ পাতা সবুজ, সমস্যা দেখিনি', fieldId: 'field-tomato' },
      { id: 'o2', at: now - 3 * D, kind: 'পোকা', note: 'জোন গ-এ কয়েকটা পাতায় ছিদ্র', fieldId: 'field-tomato' },
      { id: 'o3', at: now - 10 * D, kind: 'রোগ', note: 'নিচের পাতায় দাগ — ছত্রাক সন্দেহ, স্প্রে করা হলো', fieldId: 'field-tomato' },
      { id: 'o4', at: now - 2 * D, kind: 'ঠিক আছে', note: 'চারা সতেজ, নতুন পাতা আসছে', fieldId: 'field-brinjal' },
    ],
    tasks: [
      { id: 't1', text: 'সকালে ট্যাংক ও পাইপ দেখা', who: 'বাবা', due: 'আজ', urgent: false, done: true },
      // a deadline that has just passed, so the overdue alert shows in the demo
      { id: 't2', text: 'জোন গ-এর গাছ বাঁধা', who: 'বাবা', due: 'আজ', urgent: false, done: false, dueAt: now - H },
      { id: 't3', text: 'হলুদ ফাঁদ বদলানো', who: 'শ্রমিক', due: 'কাল', urgent: false, done: false, dueAt: now + D },
      { id: 't4', text: 'পাকা টমেটো তোলা ও ক্রেটে ভরা', who: 'বাবা', due: 'এই সপ্তাহ', urgent: true, done: false, dueAt: now + 3 * D },
      { id: 't5', text: 'টমেটোতে ছত্রাকনাশক স্প্রে', who: 'বাবা', due: 'এই সপ্তাহ', urgent: false, done: false, dueAt: now + 2 * D, repeatDays: 10, fieldId: 'field-tomato' },
      { id: 't6', text: 'বেগুনে সার ও মালচ দেখা', who: 'আমি', due: 'এই সপ্তাহ', urgent: false, done: false, dueAt: now + 4 * D, fieldId: 'field-brinjal' },
    ],
    ledger: [
      { id: 'e1', at: now - 2 * H, type: 'income', cat: 'ফসল বিক্রি', amount: 4800, note: '১২০ কেজি টমেটো', fieldId: 'field-tomato' },
      { id: 'e2', at: now - D, type: 'expense', cat: 'সার', amount: 3200, note: 'ইউরিয়া ও পটাশ', fieldId: 'field-tomato' },
      { id: 'e3', at: now - 3 * D, type: 'expense', cat: 'শ্রম', amount: 2500, note: 'সাপ্তাহিক মজুরি' },
      { id: 'e4', at: now - 4 * D, type: 'expense', cat: 'কীটনাশক', amount: 1800, note: 'ছত্রাকনাশক ও ফাঁদ', fieldId: 'field-tomato' },
      { id: 'e5', at: now - 7 * D, type: 'income', cat: 'ফসল বিক্রি', amount: 4500, note: '৯০ কেজি টমেটো', fieldId: 'field-tomato' },
      { id: 'e6', at: now - 10 * D, type: 'expense', cat: 'সার', amount: 600, note: 'বেগুনের জৈব সার', fieldId: 'field-brinjal' },
      { id: 'e7', at: now - 14 * D, type: 'income', cat: 'ফসল বিক্রি', amount: 5500, note: '১০০ কেজি টমেটো', fieldId: 'field-tomato' },
      { id: 'e8', at: now - 17 * D, type: 'expense', cat: 'শ্রম', amount: 2500, note: 'সাপ্তাহিক মজুরি' },
      { id: 'e9', at: now - 20 * D, type: 'expense', cat: 'সরঞ্জাম', amount: 1500, note: 'মালচ শিট ও ড্রিপ জোড়া', fieldId: 'field-brinjal' },
      { id: 'e10', at: now - 25 * D, type: 'expense', cat: 'বীজ ও চারা', amount: 900, note: 'বেগুনের চারা', fieldId: 'field-brinjal' },
      { id: 'e11', at: now - 31 * D, type: 'expense', cat: 'শ্রম', amount: 4000, note: 'টমেটো মাচা ও চারা রোপণ', fieldId: 'field-tomato' },
      { id: 'e12', at: now - 38 * D, type: 'expense', cat: 'সরঞ্জাম', amount: 1200, note: 'বাঁশের খুঁটি ও দড়ি' },
      { id: 'e13', at: now - 52 * D, type: 'expense', cat: 'বীজ ও চারা', amount: 3500, note: 'টমেটোর চারা', fieldId: 'field-tomato' },
    ],
    stock: [
      { id: 'k1', name: 'ইউরিয়া সার', unit: 'কেজি', qty: 18, min: 10 },
      { id: 'k2', name: 'পটাশ সার', unit: 'কেজি', qty: 6, min: 10 },
      { id: 'k3', name: 'জৈব সার', unit: 'কেজি', qty: 120, min: 50 },
      { id: 'k4', name: 'কীটনাশক', unit: 'লিটার', qty: 1.5, min: 1 },
      { id: 'k5', name: 'মালচ শিট', unit: 'রোল', qty: 2, min: 1 },
      { id: 'k6', name: 'বাঁশের খুঁটি', unit: 'পিস', qty: 140, min: 100 },
    ],
    notif: { push: true, sms: true, whatsapp: false, telegram: false },
    team: [
      { id: 'm1', name: 'আপনি', role: 'মালিক' },
      { id: 'm2', name: 'বাবা', role: 'অপারেটর' },
    ],
  }
}

/** Static device list for নমুনা মোড (mirrors the backend seed). */
export function seedDevices(): DeviceStatus[] {
  const now = Date.now()
  return [
    { id: 'esp32-gw-1', kind: 'gateway' as const, online: true, metrics: { rssi: -61, uptime_h: 312 }, lastSeenAt: now - 60_000 },
    { id: 'esp32-field-1', kind: 'sensor' as const, online: true, metrics: { battery_v: 12.6, signal: 82 }, lastSeenAt: now - 60_000 },
    { id: 'pump-relay-1', kind: 'relay' as const, online: true, metrics: { state: 0, current_a: 0 }, lastSeenAt: now - 60_000 },
  ]
}
