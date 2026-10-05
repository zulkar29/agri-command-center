import { View } from 'react-native'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { bn } from '@/lib/format'
import { C } from '@/lib/theme'
import { demoAtom, serverUrlAtom } from '@/state/conn'
import { outboxAtom } from '@/state/outbox'
import { liveAtom } from '@/state/farm'
import { AppText } from './ui/text'

/** Small connection indicator: সার্ভার (green) / নমুনা (blue) / বিচ্ছিন্ন (red). */
export function ConnBadge() {
  const { t } = useTranslation()
  const serverUrl = useAtomValue(serverUrlAtom)
  const demo = useAtomValue(demoAtom)
  const live = useAtomValue(liveAtom)
  const waiting = useAtomValue(outboxAtom).length

  const state = demo
    ? { color: C.info, label: t('m.conn.badgeDemo') }
    : live
      ? { color: C.ok, label: t('m.conn.badgeServer') }
      : serverUrl
        ? { color: C.bad, label: t('m.conn.badgeOffline') }
        : { color: C.neutral, label: t('m.conn.badgeDemo') }

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingTop: 4 }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: state.color }} />
      <AppText weight="semi" style={{ fontSize: 12, color: C.muted }}>
        {state.label}
        {waiting > 0 ? ` · ${t('m.offline.waiting', { n: bn(waiting) })}` : ''}
      </AppText>
    </View>
  )
}
