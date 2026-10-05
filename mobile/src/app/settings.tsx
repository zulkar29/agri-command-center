import { Controller, useForm } from 'react-hook-form'
import { View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { router } from 'expo-router'
import { ConnBadge } from '@/components/conn-badge'
import { ContactCard } from '@/components/contact-card'
import { PumpSettingsCard } from '@/components/pump-settings-card'
import { Screen } from '@/components/screen'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardTitle } from '@/components/ui/card'
import { Field, Input } from '@/components/ui/input'
import { AppSwitch } from '@/components/ui/switch'
import { AppText } from '@/components/ui/text'
import { bn } from '@/lib/format'
import { C } from '@/lib/theme'
import type { NotifSettings, Role } from '@/lib/types'
import { useAtomValue } from 'jotai'
import { authSessionAtom, demoAtom, disconnect, serverUrlAtom, startDemo, useCan } from '@/state/conn'
import i18n, { setLang, type Lang } from '@/i18n'
import { roleLabel } from '@/lib/labels'
import { useFarm } from '@/state/farm'
import { useLogout } from '@/services/auth'
import { useFields } from '@/services/fields'

const CHANNELS: (keyof NotifSettings)[] = ['push', 'sms', 'whatsapp', 'telegram']
const LANGS: { value: Lang; label: string }[] = [
  { value: 'bn', label: 'বাংলা' },
  { value: 'en', label: 'English' },
]

const ROLE_TONE: Record<Role, 'info' | 'ok' | 'neutral'> = { মালিক: 'info', অপারেটর: 'ok', দর্শক: 'neutral' } // keys are the API's role values

const OSS = [
  { labelKey: 'settings.ossSource', valueKey: 'settings.ossSourceValue' },
  { labelKey: 'settings.ossSelfHost', valueKey: 'settings.ossSelfHostValue' },
]

// still-open items from docs/06-roadmap.md (weather and crop templates are done)
const ROADMAP = [
  'ESP32 ফার্মওয়্যার ও MQTT ব্রিজ',
  'নিজের নিয়ম বানানো (নিয়মের প্যারামিটার)',
  'ছবি তুলে রোগ ও পোকার রেকর্ড',
  'পুশ নোটিফিকেশন',
]

/** সেটিংস: ফার্ম, সংযোগ ও নোটিফিকেশন। */
export default function SettingsScreen() {
  const { t } = useTranslation()
  const s = useFarm()
  const serverUrl = useAtomValue(serverUrlAtom)
  const demo = useAtomValue(demoAtom)
  const user = useAtomValue(authSessionAtom)?.user ?? null
  // farm info is one form with a Save button; it refills when the server snapshot changes
  const farmForm = useForm<{ name: string; lat: string; lng: string }>({
    values: { name: s.farmName, lat: s.lat != null ? String(s.lat) : '', lng: s.lng != null ? String(s.lng) : '' },
  })
  const logoutMutation = useLogout()
  const can = useCan()

  const fields = useFields()
  const area = fields.reduce((a, f) => a + f.area, 0)
  const plants = fields.reduce((a, f) => a + f.plants, 0)

  const saveFarm = farmForm.handleSubmit((v) => {
    if (v.name.trim() && v.name.trim() !== s.farmName) s.setFarmName(v.name.trim())
    const la = parseFloat(v.lat)
    const lo = parseFloat(v.lng)
    if (!Number.isNaN(la) && la !== s.lat) s.setLat(la)
    if (!Number.isNaN(lo) && lo !== s.lng) s.setLng(lo)
  })

  const changeServer = () => {
    disconnect()
    router.replace('/connect')
  }

  const logout = () => logoutMutation.mutate(undefined, { onSettled: () => router.replace('/connect') })

  const useDemo = () => {
    startDemo()
    router.replace('/')
  }

  return (
    <Screen title={t('nav.settings.label')} sub={t('m.settingsSub')} onBack={() => router.back()} right={<ConnBadge />}>
      <Card>
        <CardTitle>{t('m.conn.server')}</CardTitle>
        <View style={{ gap: 6 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
            <AppText style={{ color: C.muted }}>{t('irrigation.modeLabel')}</AppText>
            <AppText weight="semi">{demo ? t('m.conn.demoMode') : s.live ? t('m.conn.connected') : t('m.conn.searching')}</AppText>
          </View>
          {serverUrl ? (
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
              <AppText style={{ color: C.muted }}>{t('m.conn.server')}</AppText>
              <AppText weight="semi" style={{ flexShrink: 1, textAlign: 'right' }}>{serverUrl}</AppText>
            </View>
          ) : null}
          {user ? (
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
              <AppText style={{ color: C.muted }}>{t('m.conn.account')}</AppText>
              <AppText weight="semi" style={{ flexShrink: 1, textAlign: 'right' }}>
                {user.name} ({user.email})
              </AppText>
            </View>
          ) : null}
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button variant="outline" style={{ flex: 1 }} onPress={changeServer}>
            {t('m.conn.changeServer')}
          </Button>
          {s.live ? (
            <Button variant="outline" style={{ flex: 1 }} onPress={useDemo}>
              {t('m.conn.demoView')}
            </Button>
          ) : null}
        </View>
        {user ? (
          <Button busy={logoutMutation.isPending} onPress={logout}>
            {t('settings.logout')}
          </Button>
        ) : null}
      </Card>

      <Card style={{ gap: 12 }}>
        <CardTitle>{t('settings.farmInfo')}</CardTitle>
        <Field label={t('settings.farmName')}>
          <Controller
            control={farmForm.control}
            name="name"
            render={({ field }) => (
              <Input value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} editable={can('farmSetup')} returnKeyType="done" />
            )}
          />
        </Field>
        {user && !demo ? (
          <Field label={t('settings.locationTitle')} hint={t('settings.locationNote')}>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Controller
                  control={farmForm.control}
                  name="lat"
                  render={({ field }) => (
                    <Input value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} inputMode="decimal" placeholder="23.8103" editable={can('farmSetup')} />
                  )}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Controller
                  control={farmForm.control}
                  name="lng"
                  render={({ field }) => (
                    <Input value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} inputMode="decimal" placeholder="90.4125" editable={can('farmSetup')} />
                  )}
                />
              </View>
            </View>
          </Field>
        ) : null}
        {can('farmSetup') ? <Button variant="outline" onPress={() => void saveFarm()}>{t('common.save')}</Button> : null}
        <AppText style={{ fontSize: 13, color: C.muted }}>
          {t('app.farmStats', { area: bn(area), plants: bn(plants), fields: bn(fields.length) })}
        </AppText>
      </Card>

      <ContactCard />
      <PumpSettingsCard />

      <Card>
        <CardTitle>{t('settings.languageTitle')}</CardTitle>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {LANGS.map((l) => (
            <Button
              key={l.value}
              variant={i18n.language === l.value ? 'solid' : 'outline'}
              style={{ flex: 1 }}
              onPress={() => setLang(l.value)}
            >
              {l.label}
            </Button>
          ))}
        </View>
      </Card>

      {demo ? (
        <Card>
          <CardTitle>{t('settings.demoModeTitle')}</CardTitle>
          <CardDescription>{t('settings.demoModeNote')}</CardDescription>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <AppText weight="semi">{t('settings.simulation')}</AppText>
            <AppSwitch value={s.simulate} onValueChange={() => s.setSimulate(!s.simulate)} />
          </View>
          <Button variant="outline" onPress={s.resetDemo}>
            {t('settings.resetDemo')}
          </Button>
        </Card>
      ) : null}

      <Card>
        <CardTitle>{t('settings.notifTitle')}</CardTitle>
        {CHANNELS.map((c) => (
          <View
            key={c}
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, borderTopWidth: 1, borderTopColor: C.border, paddingTop: 10 }}
          >
            <AppText>{t(`settings.channels.${c}`)}</AppText>
            <AppSwitch value={s.notif[c]} disabled={!can('farmSetup')} onValueChange={() => s.toggleNotif(c)} />
          </View>
        ))}
        <AppText style={{ fontSize: 12.5, color: C.muted }}>{t('settings.notifNote')}</AppText>
      </Card>

      <Card>
        <CardTitle>{t('settings.teamTitle')}</CardTitle>
        <CardDescription>{t('settings.teamNote')}</CardDescription>
        {s.team.map((m) => (
          <View
            key={m.id}
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, borderTopWidth: 1, borderTopColor: C.border, paddingTop: 10 }}
          >
            <AppText weight="semi">{m.name}</AppText>
            <Badge t={ROLE_TONE[m.role]}>{roleLabel(m.role)}</Badge>
          </View>
        ))}
      </Card>

      <Card>
        <CardTitle>{t('settings.ossTitle')}</CardTitle>
        {OSS.map((o) => (
          <View key={o.labelKey} style={{ gap: 2, borderTopWidth: 1, borderTopColor: C.border, paddingTop: 10 }}>
            <AppText style={{ fontSize: 12.5, color: C.muted }}>{t(o.labelKey)}</AppText>
            <AppText style={{ lineHeight: 21 }}>{t(o.valueKey)}</AppText>
          </View>
        ))}
      </Card>

      <Card>
        <CardTitle>{t('settings.roadmapTitle')}</CardTitle>
        {ROADMAP.map((r) => (
          <View
            key={r}
            style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, borderTopWidth: 1, borderTopColor: C.border, paddingTop: 10 }}
          >
            <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: C.info, marginTop: 5 }} />
            <AppText style={{ flex: 1, lineHeight: 21 }}>{r}</AppText>
          </View>
        ))}
      </Card>

      <AppText style={{ fontSize: 12, color: C.muted, textAlign: 'center' }}>
        {t('app.name')} · v১.০.০
      </AppText>
    </Screen>
  )
}
