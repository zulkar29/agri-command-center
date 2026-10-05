import { View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { ConnBadge } from '@/components/conn-badge'
import { LineChart } from '@/components/charts'
import { PumpToggleRow } from '@/components/pump-row'
import { Screen } from '@/components/screen'
import { WeeklyCard } from '@/components/weekly-card'
import { ZoneBars } from '@/components/zone-bars'
import { Badge, toneDot } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardTitle } from '@/components/ui/card'
import { StatTile } from '@/components/ui/stat-tile'
import { AppText } from '@/components/ui/text'
import { FORECAST, ZONES } from '@/lib/constants'
import { bn, whenLabel } from '@/lib/format'
import { forecastDayLabel, zoneLabel } from '@/lib/labels'
import { deriveRecs, mean, riskInfo, type Rec } from '@/lib/farm'
import { C } from '@/lib/theme'
import { go } from '@/lib/nav'
import { useMoisture24h } from '@/services/farm'
import { useFields } from '@/services/fields'
import { useStock } from '@/services/inventory'
import { useTasks } from '@/services/tasks'
import { useFarmAlerts } from '@/services/alerts'
import { useWeather } from '@/services/weather'
import { useCan } from '@/state/conn'
import { useFarm } from '@/state/farm'
import i18n from '@/i18n'

/** ওভারভিউ: আজ ফার্মে কী চলছে আর কী করতে হবে (mobile twin of the dashboard page). */
export default function OverviewScreen() {
  const { t } = useTranslation()
  const s = useFarm()
  const can = useCan()
  const tasks = useTasks()
  const stock = useStock()
  const fields = useFields()
  const th = s.threshold
  // server-evaluated alerts while live, the demo derivation otherwise
  const { items: alertItems, ack } = useFarmAlerts()
  const alerts = alertItems
  // live forecast when the farm has coordinates; the sample otherwise
  const weather = useWeather(s.live)
  const forecastDays =
    s.live && weather.data
      ? weather.data.daily.map((d) => ({
          key: d.date,
          label: new Date(d.date).toLocaleDateString(
            i18n.language === 'bn' ? 'bn-BD' : 'en-GB',
            { weekday: 'short' },
          ),
          rain: d.rain,
        }))
      : FORECAST.map((f) => ({ key: f.day, label: forecastDayLabel(f.day), rain: f.rain }))
  const rainTomorrow = forecastDays[1]?.rain ?? FORECAST[1].rain
  // recommendations read tasks/stock/fields — the server's while live, not the demo store's
  const recs = deriveRecs({ ...s, tasks, stock, fields }, rainTomorrow)
  const avg = Math.round(mean(s.moist))
  const tank = Math.round(s.tank)
  const hum = Math.round(s.humidity)
  const risk = riskInfo(hum)
  const todayTasks = tasks.filter((t) => !t.done && t.due === 'আজ')
  const hist = useMoisture24h(s.live)

  const runRec = (r: Rec) => {
    if (!r.action) return
    if (r.action.zone !== undefined) s.waterZones([r.action.zone], ZONES[r.action.zone])
    else if (r.action.view) go(r.action.view)
  }
  // recommendations that water need irrigation rights; "see it" links don't
  const recLocked = (r: Rec) => r.action?.zone !== undefined && !can('irrigation')

  return (
    <Screen title={s.farmName} sub={t('nav.overview.sub')} right={<ConnBadge />}>
      <Card>
        <CardTitle>{t('overview.summaryTitle')}</CardTitle>
        {recs.map((r) => (
          <View
            key={r.id}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: 1, borderTopColor: C.border, paddingTop: 10 }}
          >
            <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: toneDot[r.tone], marginTop: 4 }} />
            <AppText style={{ flex: 1, lineHeight: 21 }}>{r.text}</AppText>
            {r.action ? (
              <Button variant="outline" size="sm" disabled={recLocked(r)} onPress={() => runRec(r)}>
                {r.action.label}
              </Button>
            ) : null}
          </View>
        ))}
      </Card>

      <WeeklyCard />

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        <StatTile
          label={t('overview.soilAvg')}
          value={bn(avg)}
          unit="%"
          pct={avg}
          t={avg < th ? 'bad' : avg < th + 8 ? 'warn' : 'ok'}
          note={t('overview.thresholdNote', { n: bn(th) })}
        />
        <StatTile
          label={t('overview.tank')}
          value={bn(tank)}
          unit="%"
          pct={tank}
          t={tank < 30 ? 'bad' : tank < 50 ? 'warn' : 'ok'}
          note={tank < 30 ? t('overview.tankLowNote') : t('overview.tankSensorNote')}
        />
        <StatTile label={t('overview.airTemp')} value={bn(Math.round(s.temp))} unit={t('units.celsius')} pct={(s.temp / 45) * 100} note={t('overview.fieldSensorNote')} />
        <StatTile label={t('overview.airHumidity')} value={bn(hum)} unit="%" pct={hum} t={risk.tone} note={t('overview.riskNote', { level: risk.level })} />
        <StatTile
          label={t('overview.battery')}
          value={bn(s.volt.toFixed(1))}
          unit={t('units.volt')}
          pct={((s.volt - 11) / 3.4) * 100}
          t={s.volt >= 12.2 ? 'ok' : 'warn'}
          note={s.volt >= 12.2 ? t('overview.chargeOk') : t('overview.chargeLow')}
        />
      </View>

      <Card>
        <CardTitle>{t('overview.quickControl')}</CardTitle>
        <PumpToggleRow disabled={!can('irrigation')} />
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button style={{ flex: 1 }} disabled={!can('irrigation')} onPress={() => s.waterZones([0, 1, 2], 'সব জোন')}>
            {t('overview.waterNow')}
          </Button>
          <Button variant="outline" style={{ flex: 1 }} disabled={!can('irrigation')} onPress={s.fillTank}>
            {t('overview.fillTank')}
          </Button>
        </View>
      </Card>

      <Card>
        <CardTitle>{t('overview.alertsTitle')}</CardTitle>
        {alerts.length === 0 ? (
          <AppText style={{ color: C.okInk, backgroundColor: C.okSoft, borderRadius: 10, padding: 12 }}>
            {t('alerts.none')}
          </AppText>
        ) : (
          alerts.map((a) => (
            <View
              key={a.id}
              style={{
                gap: 6,
                borderRadius: 10,
                borderWidth: 1,
                borderColor: C.border,
                backgroundColor: C.bg,
                padding: 12,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <AppText weight="semi" style={{ flexShrink: 1 }}>{a.title}</AppText>
                <Badge t={a.tone}>{a.tone === 'bad' ? t('alerts.urgent') : t('alerts.watch')}</Badge>
              </View>
              <AppText style={{ fontSize: 13, color: C.muted }}>{a.detail}</AppText>
              <Button variant="outline" size="sm" disabled={!can('irrigation')} onPress={() => ack(a.id)} style={{ alignSelf: 'flex-start' }}>
                {t('alerts.ack')}
              </Button>
            </View>
          ))
        )}
      </Card>

      <Card>
        <CardTitle>{t('overview.zoneBarsTitle')}</CardTitle>
        <ZoneBars moist={s.moist} threshold={th} />
      </Card>

      <Card>
        <CardTitle>{t('overview.moist24hTitle')}</CardTitle>
        <CardDescription>
          {s.live ? t('overview.moist24hLiveNote') : t('overview.moist24hNote')}
        </CardDescription>
        <LineChart
          series={ZONES.map((z, i) => ({
            name: zoneLabel(z),
            color: C.chart[i],
            data: hist.zones[i] ?? [],
          }))}
          labels={hist.labels}
          yMin={0}
          yMax={100}
          marker={{ value: th, label: t('m.analytics.thresholdN', { n: bn(th) }) }}
          height={190}
          yFmt={(v) => `${bn(v)}%`}
        />
      </Card>

      <Card>
        <CardTitle>{t('overview.forecastTitle')}</CardTitle>
        <CardDescription>{t('overview.forecastNote')}</CardDescription>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {forecastDays.map((f) => (
            <View
              key={f.key}
              style={{ flex: 1, alignItems: 'center', gap: 6, borderRadius: 10, backgroundColor: C.bg, paddingVertical: 10 }}
            >
              <AppText weight="semi" style={{ fontSize: 13 }}>{f.label}</AppText>
              <View style={{ height: 56, width: 5, borderRadius: 3, backgroundColor: C.border, justifyContent: 'flex-end' }}>
                <View
                  style={{
                    width: '100%',
                    height: `${Math.max(8, f.rain)}%`,
                    borderRadius: 3,
                    backgroundColor: f.rain >= 60 ? C.info : '#9dbcd9',
                  }}
                />
              </View>
              <AppText style={{ fontSize: 11.5, color: C.muted }}>{t('overview.rain', { n: bn(Math.round(f.rain)) })}</AppText>
            </View>
          ))}
        </View>
      </Card>

      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <CardTitle>{t('overview.todayTasks')}</CardTitle>
          <Button variant="ghost" size="sm" onPress={() => go('tasks')}>
            {t('overview.allTasks')}
          </Button>
        </View>
        {todayTasks.length === 0 ? (
          <AppText style={{ fontSize: 13, color: C.muted }}>{t('overview.noTasksToday')}</AppText>
        ) : (
          todayTasks.map((t) => (
            <View
              key={t.id}
              style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, borderTopWidth: 1, borderTopColor: C.border, paddingTop: 10 }}
            >
              <AppText style={{ flex: 1 }}>{t.text}</AppText>
              <Badge>{t.who}</Badge>
            </View>
          ))
        )}
      </Card>

      <Card>
        <CardTitle>{t('overview.recentIrrigation')}</CardTitle>
        {s.irrLog.slice(0, 5).map((e) => (
          <View key={e.id} style={{ gap: 2, borderTopWidth: 1, borderTopColor: C.border, paddingTop: 10 }}>
            <AppText style={{ fontSize: 12, color: C.muted }}>{whenLabel(e.at)}</AppText>
            <AppText>{e.text}</AppText>
          </View>
        ))}
      </Card>
    </Screen>
  )
}
