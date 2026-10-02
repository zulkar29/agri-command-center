import { useState } from 'react'
import { ChevronDown, Copy, SquarePlus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Panel } from '@/components/panel'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** How to make a board report to this farm: the payload, the curl test and the endpoints — with the farm's real slug. */
export function ConnectGuide({ slug, onCopy }: { slug: string; onCopy: (text: string) => void }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const origin = typeof window === 'undefined' ? '' : window.location.origin
  const payload = `{
  "farm": "${slug}",
  "node": "esp32-field-1",
  "soil_moisture": [44, 38, 31],
  "air_temp": 28.0,
  "air_humidity": 78,
  "tank_level": 68,
  "battery_v": 12.6
}`
  const curl = `curl -X POST ${origin}/api/v1/telemetry \\
  -H 'Content-Type: application/json' \\
  -H 'X-Device-Key: <device-key>' \\
  -d '{"farm":"${slug}","node":"esp32-field-1","soil_moisture":[44,38,31]}'`
  const rows = [
    { label: t('devices.postUrl'), value: 'POST /api/v1/telemetry', copy: `${origin}/api/v1/telemetry` },
    { label: t('devices.mqttTopic'), value: `farm/${slug}/telemetry`, copy: `farm/${slug}/telemetry` },
    { label: t('devices.pumpCmd'), value: `farm/${slug}/pump/set`, copy: `farm/${slug}/pump/set` },
  ]
  const block = (text: string) => (
    <div className="relative">
      <pre className="overflow-x-auto rounded-lg bg-foreground p-3.5 pr-12 font-mono text-[13px] leading-relaxed text-background">{text}</pre>
      <Button variant="secondary" size="icon" className="absolute top-2 right-2 size-8" aria-label={t('devices.copy')} onClick={() => onCopy(text)}>
        <Copy className="size-4" />
      </Button>
    </div>
  )
  return (
    <Panel
      title={t('devices.addTitle')}
      description={t('devices.addNote')}
      icon={SquarePlus}
      tone="warn"
      action={
        <Button variant="outline" size="sm" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? t('devices.hideGuide') : t('devices.showGuide')}
          <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} />
        </Button>
      }
    >
      {open ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="flex flex-col gap-3">
            {block(payload)}
            <div>
              {rows.map((r) => (
                <div key={r.value} className="flex items-center justify-between gap-3 border-t py-2.5">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-[13px] text-muted-foreground">{r.label}</span>
                    <code className="truncate font-mono text-[13px]">{r.value}</code>
                  </div>
                  <Button variant="ghost" size="icon" className="size-8 shrink-0" aria-label={t('devices.copy')} onClick={() => onCopy(r.copy)}>
                    <Copy className="size-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <p className="text-[13.5px] font-semibold">{t('devices.curl')}</p>
            {block(curl)}
            <p className="text-[13px] text-muted-foreground">{t('devices.keyHint')}</p>
          </div>
        </div>
      ) : null}
    </Panel>
  )
}
