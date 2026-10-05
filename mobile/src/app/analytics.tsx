import { useMemo, useState } from 'react'
import { View } from 'react-native'
import { router } from 'expo-router'
import { useAtomValue } from 'jotai'
import { BarChart, LineChart } from '@/components/charts'
import { Screen } from '@/components/screen'
import { WaterCard } from '@/components/water-card'
import { ZoneBars } from '@/components/zone-bars'
import { toneDot } from '@/components/ui/badge'
import { Card, CardDescription, CardTitle } from '@/components/ui/card'
import { ChoiceChips } from '@/components/ui/chips'
import { StatTile } from '@/components/ui/stat-tile'
import { AppText } from '@/components/ui/text'
import { ZONES } from '@/lib/constants'
import { bn } from '@/lib/format'
import { mean } from '@/lib/farm'
import { dailySeries } from '@/lib/history'
import { C } from '@/lib/theme'
import type { TelemetryRow } from '@/lib/types'
import { useTelemetry } from '@/services/farm'
import { useTranslation } from 'react-i18next'
import i18n from '@/i18n'
import { zoneLabel } from '@/lib/labels'
import { demoAtom } from '@/state/conn'
import { useFarm, type FarmStore } from '@/state/farm'

const LIVE_RANGES = [
  { value: '24', key: 'm.analytics.hours24' },
  { value: '168', key: 'analytics.days7' },
]
const DEMO_RANGES = [
  { value: '7', key: 'analytics.days7' },
  { value: '14', key: 'analytics.days14' },
  { value: '30', key: 'analytics.days30' },
]

/** বিশ্লেষণ: পানি, আর্দ্রতা ও আবহাওয়ার প্রবণতা — live mode reads /api/v1/telemetry,
 * নমুনা মোড shows the sample series the dashboard draws. */
export default function AnalyticsScreen() {
  const { t } = useTranslation()
  const s = useFarm()
  const demo = useAtomValue(demoAtom)
  const [liveHours, setLiveHours] = useState('24')
  const [demoDays, setDemoDays] = useState('7')
  const telemetry = useTelemetry(Number(liveHours), !demo)
  const rows = useMemo(() => telemetry.data ?? [], [telemetry.data])

  const live = useMemo(() => buildLiveSeries(rows, liveHours === '24'), [rows, liveHours])
  const demoSeries = useMemo(() => dailySeries(Number(demoDays)), [demoDays])
  const perTree = useMemo(() => {
    const n = Number(demoDays)
    const plants = s.fields.reduce((a, f) => a + f.plants, 0)
    const total = demoSeries.water.reduce((a, b) => a + b, 0)
    return (total / n / Math.max(1, plants)).toFixed(1)
  }, [demoDays, demoSeries, s.fields])

  return (
    <Screen title={t('nav.analytics.label')} sub={t('nav.analytics.sub')} onBack={() => router.back()}>
      {!demo ? (
        <>
          <WaterCard />
          <ChoiceChips value={liveHours} onChange={setLiveHours} options={LIVE_RANGES.map((r) => ({ value: r.value, label: t(r.key) }))} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            <StatTile label={t('m.analytics.avgSoil')} value={bn(live.latestMoist)} unit="%" pct={live.latestMoist} t={live.latestMoist < s.threshold ? 'bad' : 'ok'} note={t('m.analytics.fromLatest')} />
            <StatTile label={t('m.analytics.maxTemp')} value={bn(live.maxTemp)} unit={t('units.celsius')} note={t('m.analytics.minTempNote', { n: bn(live.minTemp) })} />
            <StatTile label={t('m.analytics.tankLatest')} value={bn(live.latestTank)} unit="%" pct={live.latestTank} t={live.latestTank < 30 ? 'bad' : 'ok'} note={t('overview.tankSensorNote')} />
            <StatTile label={t('m.analytics.readings')} value={bn(rows.length)} note={t('m.analytics.inLast', { range: liveHours === '24' ? t('m.analytics.last24h') : t('m.analytics.days7') })} />
          </View>
          {live.labels.length > 1 ? (
            <>
              <Card>
                <CardTitle>{t('m.analytics.soilMoisture')}</CardTitle>
                <CardDescription>{t('analytics.dashMark')}</CardDescription>
                <LineChart
                  series={ZONES.map((z, i) => ({ name: zoneLabel(z), color: C.chart[i], data: live.moist[i] }))}
                  labels={live.labels}
                  yMin={0}
                  yMax={100}
                  marker={{ value: s.threshold, label: t('m.analytics.thresholdN', { n: bn(s.threshold) }) }}
                  height={190}
                  yFmt={(v) => `${bn(v)}%`}
                />
              </Card>
              <Card>
                <CardTitle>{t('analytics.weatherChart')}</CardTitle>
                <LineChart
                  series={[
                    { name: t('m.analytics.tempSeries'), color: C.warn, data: live.temp },
                    { name: t('m.analytics.moistSeries'), color: C.info, data: live.humidity },
                  ]}
                  labels={live.labels}
                  yMin={0}
                  yMax={100}
                  height={190}
                />
              </Card>
              <Card>
                <CardTitle>{t('overview.tank')}</CardTitle>
                <LineChart
                  series={[{ name: t('overview.tank'), color: C.primary, data: live.tank }]}
                  labels={live.labels}
                  yMin={0}
                  yMax={100}
                  height={170}
                  legend={false}
                  yFmt={(v) => `${bn(v)}%`}
                />
              </Card>
            </>
          ) : (
            <Card>
              <AppText style={{ color: C.muted }}>{t('m.analytics.noTelemetry')}</AppText>
            </Card>
          )}
        </>
      ) : (
        <>
          <ChoiceChips value={demoDays} onChange={setDemoDays} options={DEMO_RANGES.map((r) => ({ value: r.value, label: t(r.key) }))} />
          {(() => {
            const n = Number(demoDays)
            const plants = s.fields.reduce((a, f) => a + f.plants, 0)
            const totalW = demoSeries.water.reduce((a, b) => a + b, 0)
            const avgW = Math.round(totalW / n)
            const perTree = (totalW / n / Math.max(1, plants)).toFixed(1)
            const wetDays = demoSeries.water.filter((v) => v > 0).length
            return (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                <StatTile label={t('analytics.totalWater')} value={bn(totalW)} unit={t('units.litersShort')} note={t('analytics.lastNDays', { n: bn(n) })} />
                <StatTile label={t('analytics.dailyAvg')} value={bn(avgW)} unit={t('units.litersShort')} note={t('analytics.allZones')} />
                <StatTile label={t('analytics.perPlant')} value={bn(perTree)} unit={t('units.litersShort')} note={t('analytics.perPlantNote', { n: bn(plants) })} />
                <StatTile label={t('analytics.wateredDays')} value={t('analytics.daysFraction', { wet: bn(wetDays), total: bn(n) })} note={t('analytics.wateredDaysNote')} />
              </View>
            )
          })()}
          <Card>
            <CardTitle>{t('analytics.irrigationChart')}</CardTitle>
            <BarChart data={demoSeries.water} labels={demoSeries.labels} color={C.info} height={180} />
            <AppText style={{ fontSize: 12.5, color: C.muted }}>{t('analytics.sampleChartNote')}</AppText>
          </Card>
          <Card>
            <CardTitle>{t('analytics.avgMoisture')}</CardTitle>
            <LineChart
              series={[{ name: t('analytics.avgMoisture'), color: C.primary, data: demoSeries.moisture }]}
              labels={demoSeries.labels}
              yMin={0}
              yMax={100}
              marker={{ value: s.threshold, label: t('m.analytics.thresholdN', { n: bn(s.threshold) }) }}
              height={180}
              yFmt={(v) => `${bn(v)}%`}
            />
          </Card>
          <Card>
            <CardTitle>{t('analytics.weatherChart')}</CardTitle>
            <LineChart
              series={[
                { name: t('m.analytics.tempSeries'), color: C.warn, data: demoSeries.temp },
                { name: t('analytics.airHumidity'), color: C.info, data: demoSeries.humidity },
              ]}
              labels={demoSeries.labels}
              yMin={0}
              yMax={100}
              height={190}
            />
          </Card>
        </>
      )}

      <Card>
        <CardTitle>{t('analytics.zoneCompare')}</CardTitle>
        <CardDescription>{t('analytics.dashMark')}</CardDescription>
        <ZoneBars moist={s.moist} threshold={s.threshold} />
      </Card>

      <Card>
        <CardTitle>{t('analytics.insightsTitle')}</CardTitle>
        {insights(s, demo, perTree).map((i) => (
          <View
            key={i.text}
            style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, borderTopWidth: 1, borderTopColor: C.border, paddingTop: 10 }}
          >
            <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: toneDot[i.tone], marginTop: 5 }} />
            <AppText style={{ flex: 1, lineHeight: 21 }}>{i.text}</AppText>
          </View>
        ))}
      </Card>
    </Screen>
  )
}

function insights(s: FarmStore, demo: boolean, perTree: string) {
  const t = i18n.t.bind(i18n)
  const driest = s.moist.indexOf(Math.min(...s.moist))
  return [
    {
      tone: 'warn' as const,
      text: t('analytics.driestInsight', { zone: zoneLabel(ZONES[driest]), v: bn(Math.round(s.moist[driest])) }),
    },
    {
      tone: 'info' as const,
      text: t('analytics.perPlantInsight', { n: bn(perTree) }),
    },
    {
      tone: 'neutral' as const,
      text: demo
        ? t('analytics.avgMoistureInsight', { n: bn(Math.round(mean(s.moist))) })
        : t('m.analytics.avgMoistureLive', { n: bn(Math.round(mean(s.moist))) }),
    },
  ]
}

function buildLiveSeries(rows: TelemetryRow[], hourly: boolean) {
  const empty = { labels: [] as string[], moist: [[], [], []] as number[][], temp: [] as number[], humidity: [] as number[], tank: [] as number[], latestMoist: 0, maxTemp: 0, minTemp: 0, latestTank: 0 }
  if (rows.length < 2) return empty
  const step = Math.max(1, Math.floor(rows.length / 96))
  const picked = rows.filter((_, i) => i % step === 0)
  if (picked[picked.length - 1] !== rows[rows.length - 1]) picked.push(rows[rows.length - 1])
  const labels = picked.map((r) => {
    const d = new Date(r.ts)
    return hourly
      ? `${bn(String(d.getHours()).padStart(2, '0'))}:00`
      : `${bn(d.getDate())} ${(i18n.t('m.monthsShort', { returnObjects: true }) as string[])[d.getMonth()]}`
  })
  const last = rows[rows.length - 1]
  const temps = rows.map((r) => r.air_temp)
  return {
    labels,
    moist: [0, 1, 2].map((z) => picked.map((r) => r.soil_moisture[z] ?? 0)),
    temp: picked.map((r) => r.air_temp),
    humidity: picked.map((r) => r.air_humidity),
    tank: picked.map((r) => r.tank_level),
    latestMoist: Math.round(mean(last.soil_moisture)),
    maxTemp: Math.round(Math.max(...temps)),
    minTemp: Math.round(Math.min(...temps)),
    latestTank: Math.round(last.tank_level),
  }
}
