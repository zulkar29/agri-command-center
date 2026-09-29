import { CalendarClock, Droplets, History, LayoutGrid, Minus, Plus, Workflow } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Controller, useForm } from 'react-hook-form'
import { ChoiceChips } from '@/components/choice-chips'
import { PumpToggleRow } from '@/components/pump-toggle-row'
import { Gauge } from '@/components/gauge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { ZONES } from '@/data/constants'
import { zoneStatus } from '@/lib/farm'
import { bn, whenLabel } from '@/lib/format'
import { downloadCSV } from '@/lib/csv'
import { zoneLabel } from '@/lib/labels'
import { useAddSchedule, useDeleteSchedule, useSchedules, useToggleSchedule } from '@/services/schedules'
import { useCan } from '@/atoms/auth'
import { useFarm } from '@/atoms/farm'
import type { Mode } from '@/types'

const MODES: { value: Mode; label: string }[] = [
  { value: 'auto', label: 'irrigation.auto' },
  { value: 'manual', label: 'irrigation.manual' },
]
const DURATIONS = ['10', '20', '30']

interface StepperRowProps {
  label: string
  hint: string
  value: string
  disabled?: boolean
  onDec: () => void
  onInc: () => void
}

function StepperRow({ label, hint, value, disabled, onDec, onInc }: StepperRowProps) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t py-3 first:border-t-0">
      <div className="flex min-w-0 flex-1 basis-44 flex-col gap-0.5">
        <span className="font-semibold">{label}</span>
        <span className="text-[13px] text-muted-foreground">{hint}</span>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="icon" aria-label={t('inventory.decrease', { name: label })} disabled={disabled} onClick={onDec}>
          <Minus />
        </Button>
        <span className="min-w-[88px] text-center text-lg font-semibold">{value}</span>
        <Button variant="outline" size="icon" aria-label={t('inventory.increase', { name: label })} disabled={disabled} onClick={onInc}>
          <Plus />
        </Button>
      </div>
    </div>
  )
}

export function IrrigationPage() {
  const { t } = useTranslation()
  const s = useFarm()
  const schedules = useSchedules()
  const addSchedule = useAddSchedule()
  const toggleSchedule = useToggleSchedule()
  const deleteSchedule = useDeleteSchedule()
  const can = useCan()
  const form = useForm<{ time: string; dur: string; zone: string }>({
    defaultValues: { time: '06:30', dur: '20', zone: 'সব জোন' },
  })
  const submitSchedule = form.handleSubmit((v) => {
    addSchedule.mutate({ time: v.time || '06:30', dur: Number(v.dur), zone: v.zone })
    form.reset()
  })

  return (
    <div className="flex flex-col gap-5">
      <section className="grid gap-5 lg:grid-cols-2">
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle icon={Droplets}>{t('irrigation.title')}</CardTitle>
            <ChoiceChips
              value={s.mode}
              onChange={s.setMode}
              options={MODES.map((m) => ({ value: m.value, label: t(m.label) }))}
              label={t('irrigation.modeLabel')}
              disabled={!can('irrigation')}
            />
          </div>
          <PumpToggleRow disabled={!can('irrigation')} />
          <div className="flex flex-col">
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
          </div>
          <div className="flex flex-wrap gap-2">
            <Button disabled={!can('irrigation')} onClick={() => s.waterZones([0, 1, 2], ZONES.join(', '))}>{t('irrigation.waterAll')}</Button>
            <Button variant="outline" disabled={!can('irrigation')} onClick={s.fillTank}>
              {t('irrigation.fillTank')}
            </Button>
          </div>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle icon={LayoutGrid}>{t('irrigation.zonesTitle')}</CardTitle>
            <CardDescription>{t('irrigation.zonesNote')}</CardDescription>
          </CardHeader>
          {ZONES.map((z, i) => {
            const st = zoneStatus(s.moist[i], s.threshold)
            return (
              <div key={z} className="flex flex-wrap items-center gap-3 border-t py-3 first:border-t-0 first:pt-0">
                <Gauge pct={s.moist[i]} tone={st.tone} size={46}>
                  <span className="text-[13px] font-bold">{bn(Math.round(s.moist[i]))}</span>
                </Gauge>
                <div className="flex min-w-0 flex-1 basis-36 flex-col gap-1">
                  <span className="font-semibold">{zoneLabel(z)}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] text-muted-foreground">{t('irrigation.moisture', { n: bn(Math.round(s.moist[i])) })}</span>
                    <Badge tone={st.tone}>{st.label}</Badge>
                  </div>
                </div>
                <Button variant="outline" size="sm" disabled={!can('irrigation')} onClick={() => s.waterZones([i], z)}>
                  {t('irrigation.water')}
                </Button>
                <Switch checked={s.valves[i]} disabled={!can('irrigation')} onCheckedChange={() => s.toggleValve(i)} aria-label={t('irrigation.valve', { zone: zoneLabel(z) })} />
              </div>
            )
          })}
        </Card>
      </section>

      <section className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardTitle icon={CalendarClock}>{t('irrigation.schedulesTitle')}</CardTitle>
          {schedules.length === 0 ? <p className="text-[13px] text-muted-foreground">{t('irrigation.noSchedules')}</p> : null}
          {schedules.map((x) => (
            <div key={x.id} className="flex flex-wrap items-center gap-3 border-t py-3 first:border-t-0 first:pt-0">
              <div className="flex min-w-0 flex-1 basis-36 flex-col">
                <span className="text-lg font-bold">{bn(x.time)}</span>
                <span className="text-[13px] text-muted-foreground">
                  {zoneLabel(x.zone)} · {t('irrigation.minutesOption', { n: bn(x.dur) })}
                </span>
              </div>
              {can('schedules') ? (
                <Button variant="danger" size="sm" onClick={() => deleteSchedule.mutate(x)}>
                  {t('common.delete')}
                </Button>
              ) : null}
              <Switch checked={x.on} disabled={!can('schedules')} onCheckedChange={() => toggleSchedule.mutate(x)} aria-label={t('irrigation.scheduleFor', { time: bn(x.time) })} />
            </div>
          ))}

          {can('schedules') ? (
          <form onSubmit={submitSchedule} className="flex flex-col gap-3 border-t pt-4">
            <span className="font-semibold">{t('irrigation.newSchedule')}</span>
            <div className="flex max-w-48 flex-col gap-1.5">
              <Label htmlFor="sched-time">{t('irrigation.time')}</Label>
              <Input
                id="sched-time"
                type="time"
                {...form.register('time', { required: t('irrigation.pickTime') })}
              />
              {form.formState.errors.time ? (
                <p className="text-[13px] text-destructive">{form.formState.errors.time.message}</p>
              ) : null}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>{t('irrigation.howLong')}</Label>
              <Controller
                control={form.control}
                name="dur"
                render={({ field }) => (
                  <ChoiceChips
                    value={field.value}
                    onChange={field.onChange}
                    options={DURATIONS.map((d) => ({ value: d, label: t('irrigation.minutesOption', { n: bn(d) }) }))}
                    label={t('irrigation.howLong')}
                  />
                )}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>{t('irrigation.whichZone')}</Label>
              <Controller
                control={form.control}
                name="zone"
                render={({ field }) => (
                  <ChoiceChips
                    value={field.value}
                    onChange={field.onChange}
                    options={[{ value: 'সব জোন', label: t('zone.all') }, ...ZONES.map((z) => ({ value: z, label: zoneLabel(z) }))]}
                    label={t('irrigation.whichZone')}
                  />
                )}
              />
            </div>
            <div>
              <Button type="submit">{t('irrigation.addSchedule')}</Button>
            </div>
          </form>
          ) : null}
        </Card>

        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader>
            <CardTitle icon={Workflow}>{t('irrigation.rulesTitle')}</CardTitle>
            <CardDescription>{t('irrigation.rulesNote')}</CardDescription>
            </CardHeader>
            {s.rules.map((r) => (
              <div key={r.id} className="flex items-center gap-3 border-t py-3 first:border-t-0 first:pt-0">
                <span className="flex-1 leading-relaxed">{r.text}</span>
                <Switch checked={r.on} disabled={!can('irrigation')} onCheckedChange={() => s.toggleRule(r.id)} aria-label={r.text} />
              </div>
            ))}
          </Card>
          <Card>
            <div className="flex items-center justify-between gap-3">
            <CardTitle icon={History}>{t('irrigation.irrLogTitle')}</CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                downloadCSV(
                  'irrigation-log.csv',
                  [t('irrigation.time'), t('irrigation.irrLogTitle')],
                  s.irrLog.map((e) => [whenLabel(e.at), e.text]),
                )
              }
            >
              {t('common.csv')}
            </Button>
            </div>
            {s.irrLog.map((e) => (
              <div key={e.id} className="flex flex-col gap-0.5 border-t py-3 first:border-t-0 first:pt-0">
                <span className="text-xs text-muted-foreground">{whenLabel(e.at)}</span>
                <span>{e.text}</span>
              </div>
            ))}
          </Card>
        </div>
      </section>
    </div>
  )
}
