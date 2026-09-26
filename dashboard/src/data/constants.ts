import type { Assignee, Due } from '@/types'

export const ZONES = ['জোন ক', 'জোন খ', 'জোন গ'] as const

/** Sample forecast. Replace with a real weather service later. */
export const FORECAST = [
  { day: 'আজ', rain: 10 },
  { day: 'কাল', rain: 70 },
  { day: 'শুক্র', rain: 30 },
  { day: 'শনি', rain: 20 },
  { day: 'রবি', rain: 55 },
] as const

export const EXPENSE_CATS = ['সার', 'কীটনাশক', 'শ্রম', 'বীজ ও চারা', 'সরঞ্জাম', 'অন্যান্য'] as const
export const INCOME_CATS = ['ফসল বিক্রি', 'অন্যান্য আয়'] as const

export const ASSIGNEES: Assignee[] = ['বাবা', 'আমি', 'শ্রমিক']
export const DUES: Due[] = ['আজ', 'কাল', 'এই সপ্তাহ', 'পরে']
