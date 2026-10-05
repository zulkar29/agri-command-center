import { View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Controller, useForm } from 'react-hook-form'
import { PumpToggleRow } from '@/components/pump-row'
import { Screen } from '@/components/screen'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardTitle } from '@/components/ui/card'
import { ChoiceChips } from '@/components/ui/chips'
import { Field, FieldError, Input } from '@/components/ui/input'
import { AppSwitch } from '@/components/ui/switch'
import { StepperRow } from '@/components/ui/stepper'
import { AppText } from '@/components/ui/text'
import { ZONES } from '@/lib/constants'
import { bn, whenLabel } from '@/lib/format'
import { zoneStatus } from '@/lib/farm'
import { zoneLabel } from '@/lib/labels'
import { C } from '@/lib/theme'
import type { Mode } from '@/lib/types'
import { useAddSchedule, useDeleteSchedule, useSchedules, useToggleSchedule } from '@/services/schedules'
import { useCan } from '@/state/conn'
import { useFarm } from '@/state/farm'

const MODES: { value: Mode; labelKey: string }[] = [
  { value: 'auto', labelKey: 'irrigation.auto' },
  { value: 'manual', labelKey: 'irrigation.manual' },
]
const DURATIONS = ['10', '20', '30']

interface SchedForm {
  time: string
  dur: string
  zone: string
}

/** "6:30", "০৬:৩০" → "06:30"; null when unparseable. */
function parseTime(raw: string): string | null {
  const digits = raw.replace(/[০-৯]/g, (d) => String('০১২৩৪৫৬৭৮৯'.indexOf(d)))
  const m = /^(\d{1,2}):?(\d{1,2})?$/.exec(digits.trim())
  if (!m) return null
  const hh = Math.min(23, Number(m[1]))
  const mm = m[2] ? Math.min(59, Number(m[2])) : 0
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

/** সেচ: পাম্প, ভালভ, সময়সূচি ও স্বয়ংক্রিয় নিয়ম। */
export default function IrrigationScreen() {
  const { t } = useTranslation()
  const s = useFarm()
  const schedules = useSchedules()
  const addSchedule = useAddSchedule()
  const toggleSchedule = useToggleSchedule()
  const deleteSchedule = useDeleteSchedule()
  const can = useCan()

  const form = useForm<SchedForm>({ defaultValues: { time: '06:30', dur: '20', zone: 'সব জোন' } })
  const add = form.handleSubmit((v) => {
    const normalized = parseTime(v.time)!
    form.setValue('time', normalized)
    addSchedule.mutate({ time: normalized, dur: Number(v.dur), zone: v.zone })
  })

  return (
    <Screen title={t('nav.irrigation.label')} sub={t('nav.irrigation.sub')}>
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <CardTitle>{t('irrigation.title')}</CardTitle>
          <ChoiceChips
            value={s.mode}
            onChange={s.setMode}
            options={MODES.map((m) => ({ value: m.value, label: t(m.labelKey) }))}
            disabled={!can('irrigation')}
          />
        </View>
        <PumpToggleRow disabled={!can('irrigation')} />
        <StepperRow
          label={t('irrigation.threshold')}
          hint={t('irrigation.thresholdHint')}
          value={`${bn(s.threshold)}%`}
          disabled={!can('irrigation')}
          onDec={() => s.adjust('threshold', -5)}
          onInc={() => s.adjust('threshold', 5)}
        />
        <StepperRow
          label={t('irrigation.duration')}
          hint={t('irrigation.durationHint')}
          value={t('irrigation.minutesOption', { n: bn(s.duration) })}
          disabled={!can('irrigation')}
          onDec={() => s.adjust('duration', -5)}
          onInc={() => s.adjust('duration', 5)}
        />
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button style={{ flex: 1 }} disabled={!can('irrigation')} onPress={() => s.waterZones([0, 1, 2], 'সব জোন')}>
            {t('irrigation.waterAll')}
          </Button>
          <Button variant="outline" style={{ flex: 1 }} disabled={!can('irrigation')} onPress={s.fillTank}>
            {t('irrigation.fillTank')}
          </Button>
        </View>
      </Card>

      <Card>
        <CardTitle>{t('irrigation.zonesTitle')}</CardTitle>
        <CardDescription>{t('irrigation.zonesNote')}</CardDescription>
        {ZONES.map((z, i) => {
          const st = zoneStatus(s.moist[i] ?? 0, s.threshold)
          return (
            <View
              key={z}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: 1, borderTopColor: C.border, paddingTop: 10 }}
            >
              <View style={{ flex: 1, gap: 3 }}>
                <AppText weight="semi">{zoneLabel(z)}</AppText>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <AppText style={{ fontSize: 12.5, color: C.muted }}>{t('irrigation.moisture', { n: bn(Math.round(s.moist[i] ?? 0)) })}</AppText>
                  <Badge t={st.tone}>{st.label}</Badge>
                </View>
              </View>
              <Button variant="outline" size="sm" disabled={!can('irrigation')} onPress={() => s.waterZones([i], z)}>
                {t('irrigation.water')}
              </Button>
              <AppSwitch value={!!s.valves[i]} disabled={!can('irrigation')} onValueChange={() => s.toggleValve(i)} />
            </View>
          )
        })}
      </Card>

      <Card>
        <CardTitle>{t('irrigation.schedulesTitle')}</CardTitle>
        {schedules.length === 0 ? <AppText style={{ fontSize: 13, color: C.muted }}>{t('irrigation.noSchedules')}</AppText> : null}
        {schedules.map((x) => (
          <View
            key={x.id}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: 1, borderTopColor: C.border, paddingTop: 10 }}
          >
            <View style={{ flex: 1 }}>
              <AppText weight="bold" style={{ fontSize: 17 }}>{bn(x.time)}</AppText>
              <AppText style={{ fontSize: 12.5, color: C.muted }}>
                {x.zone} · {t('irrigation.minutesOption', { n: bn(x.dur) })}
              </AppText>
            </View>
            {can('schedules') ? (
              <Button variant="danger" size="sm" onPress={() => deleteSchedule.mutate(x)}>
                {t('common.delete')}
              </Button>
            ) : null}
            <AppSwitch value={x.on} disabled={!can('schedules')} onValueChange={() => toggleSchedule.mutate(x)} />
          </View>
        ))}

        {can('schedules') ? (
        <View style={{ gap: 12, borderTopWidth: 1, borderTopColor: C.border, paddingTop: 12 }}>
          <AppText weight="semi">{t('irrigation.newSchedule')}</AppText>
          <Field label={`${t('irrigation.time')} (24)`} hint="06:30 / ০৬:৩০">
            <Controller
              control={form.control}
              name="time"
              rules={{
                required: t('irrigation.pickTime'),
                validate: (v) => parseTime(v) !== null || t('irrigation.timeInvalid'),
              }}
              render={({ field: { value, onChange, onBlur } }) => (
                <Input
                  value={value}
                  onChangeText={onChange}
                  onBlur={onBlur}
                  inputMode="numeric"
                  placeholder="06:30"
                  maxLength={5}
                  returnKeyType="done"
                  onSubmitEditing={add}
                />
              )}
            />
            {form.formState.errors.time ? <FieldError>{form.formState.errors.time.message}</FieldError> : null}
          </Field>
          <Field label={t('irrigation.howLong')}>
            <Controller
              control={form.control}
              name="dur"
              render={({ field: { value, onChange } }) => (
                <ChoiceChips
                  value={value}
                  onChange={onChange}
                  options={DURATIONS.map((d) => ({ value: d, label: t('irrigation.minutesOption', { n: bn(d) }) }))}
                />
              )}
            />
          </Field>
          <Field label={t('irrigation.whichZone')}>
            <Controller
              control={form.control}
              name="zone"
              render={({ field: { value, onChange } }) => (
                <ChoiceChips
                  value={value}
                  onChange={onChange}
                  options={[{ value: 'সব জোন', label: t('zone.all') }, ...ZONES.map((z) => ({ value: z, label: zoneLabel(z) }))]}
                />
              )}
            />
          </Field>
          <Button onPress={add} busy={addSchedule.isPending}>{t('irrigation.addSchedule')}</Button>
        </View>
        ) : null}
      </Card>

      <Card>
        <CardTitle>{t('irrigation.rulesTitle')}</CardTitle>
        <CardDescription>{t('irrigation.rulesNote')}</CardDescription>
        {s.rules.map((r) => (
          <View
            key={r.id}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: 1, borderTopColor: C.border, paddingTop: 10 }}
          >
            <AppText style={{ flex: 1, lineHeight: 21 }}>{r.text}</AppText>
            <AppSwitch value={r.on} disabled={!can('irrigation')} onValueChange={() => s.toggleRule(r.id)} />
          </View>
        ))}
      </Card>

      <Card>
        <CardTitle>{t('irrigation.irrLogTitle')}</CardTitle>
        {s.irrLog.map((e) => (
          <View key={e.id} style={{ gap: 2, borderTopWidth: 1, borderTopColor: C.border, paddingTop: 10 }}>
            <AppText style={{ fontSize: 12, color: C.muted }}>{whenLabel(e.at)}</AppText>
            <AppText>{e.text}</AppText>
          </View>
        ))}
      </Card>
    </Screen>
  )
}
