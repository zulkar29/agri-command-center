import { useMemo } from 'react'
import { View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { router } from 'expo-router'
import { useAtomValue } from 'jotai'
import { Screen } from '@/components/screen'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardTitle } from '@/components/ui/card'
import { AppText } from '@/components/ui/text'
import i18n from '@/i18n'
import { bn, whenLabel } from '@/lib/format'
import { seedDevices } from '@/lib/seed'
import { C, R } from '@/lib/theme'
import type { DeviceKind, DeviceStatus } from '@/lib/types'
import { useTranslation } from 'react-i18next'
import { useDeviceCommand, useDevices } from '@/services/devices'
import { demoAtom } from '@/state/conn'

const KIND_ICON: Record<DeviceKind, keyof typeof Ionicons.glyphMap> = {
  sensor: 'speedometer-outline',
  relay: 'toggle-outline',
  gateway: 'wifi-outline',
}
const KIND_LABEL: Record<DeviceKind, string> = { sensor: 'm.devices.sensor', relay: 'm.devices.relay', gateway: 'm.devices.gateway' }

const METRICS: Record<string, (v: number) => string> = {
  battery_v: (v) => i18n.t('devices.voltBattery', { n: bn(v.toFixed(1)) }),
  signal: (v) => `${bn(Math.round(v))}%`,
  rssi: (v) => `${bn(Math.round(v))} dBm`,
  uptime_h: (v) => i18n.t('devices.uptime', { n: bn(Math.round(v)) }),
  state: (v) => (v >= 1 ? i18n.t('m.devices.on') : i18n.t('m.devices.off')),
  current_a: (v) => i18n.t('devices.current', { n: bn(v.toFixed(1)) }),
}

/** ডিভাইস: সেন্সর, রিলে ও সংযোগের অবস্থা। */
export default function DevicesScreen() {
  const { t } = useTranslation()
  const demo = useAtomValue(demoAtom)
  const query = useDevices(demo)
  const command = useDeviceCommand()
  // নমুনা মোডে সার্ভার নেই — ব্যাকএন্ডের সিডের মতো স্থির তালিকা দেখাই
  const demoList = useMemo(() => seedDevices(), [])
  const devices: DeviceStatus[] = demo ? demoList : (query.data ?? [])

  return (
    <Screen title={t('nav.devices.label')} sub={t('nav.devices.sub')} onBack={() => router.back()}>
      {demo ? (
        <Card>
          <CardTitle>{t('m.conn.demoMode')}</CardTitle>
          <CardDescription>{t('m.devices.demoNote')}</CardDescription>
        </Card>
      ) : null}

      {devices.map((d) => {
        const busy = command.isPending && command.variables?.id === d.id
        return (
          <Card key={d.id}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: 12,
                  backgroundColor: d.online ? C.okSoft : C.neutralSoft,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name={KIND_ICON[d.kind]} size={20} color={d.online ? C.primary : C.muted} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <AppText weight="semi" style={{ fontSize: 15.5 }}>{d.id}</AppText>
                <AppText style={{ fontSize: 12.5, color: C.muted }}>
                  {i18n.t(KIND_LABEL[d.kind])} · {t('m.devices.lastSeen')} {whenLabel(d.lastSeenAt)}
                </AppText>
              </View>
              <Badge t={d.online ? 'ok' : 'neutral'}>{d.online ? t('devices.online') : t('m.devices.offline')}</Badge>
            </View>

            {Object.keys(d.metrics).length > 0 ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {Object.entries(d.metrics).map(([k, v]) => (
                  <View
                    key={k}
                    style={{
                      borderRadius: R.sm,
                      backgroundColor: C.bg,
                      paddingHorizontal: 8,
                      paddingVertical: 4,
                    }}
                  >
                    <AppText style={{ fontSize: 12.5, color: C.muted }}>
                      {(METRICS[k] ?? ((x: number) => bn(Math.round(x))))(v)}
                    </AppText>
                  </View>
                ))}
              </View>
            ) : null}

            {d.kind === 'relay' && !demo ? (
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Button
                  style={{ flex: 1 }}
                  size="sm"
                  busy={busy}
                  onPress={() => command.mutate({ id: d.id, command: 'on' })}
                >
                  {t('m.devices.on')}
                </Button>
                <Button
                  style={{ flex: 1 }}
                  size="sm"
                  variant="outline"
                  busy={busy}
                  onPress={() => command.mutate({ id: d.id, command: 'off' })}
                >
                  {t('m.devices.off')}
                </Button>
              </View>
            ) : null}
          </Card>
        )
      })}
    </Screen>
  )
}
