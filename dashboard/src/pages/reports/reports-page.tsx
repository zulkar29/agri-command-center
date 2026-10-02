import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useForm, useWatch } from 'react-hook-form'
import { ClipboardList, FileDown, FileText, GraduationCap, Info, Scale, type LucideIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import { ChoiceChips } from '@/components/choice-chips'
import { Panel } from '@/components/panel'
import { Button } from '@/components/ui/button'
import { useFarm } from '@/atoms/farm'
import { currentUserAtom } from '@/atoms/auth'
import { useAtomValue } from 'jotai'
import { useReportData } from '@/services/reports'
import { PERIODS, REPORT_KINDS, reportFileName, type Period, type ReportKind } from '@/lib/report'
import { toneChip } from '@/lib/tone'
import { cn } from '@/lib/utils'
import { ReportDocument, type ReportNotes } from './report-document'

const KIND_ICON: Record<ReportKind, LucideIcon> = { full: FileText, pnl: Scale, actions: ClipboardList, lessons: GraduationCap }
const NOTES_KEY = 'farm-command-report-notes'
const NO_NOTES: ReportNotes = { worked: '', failed: '', next: '' }

function loadNotes(): ReportNotes {
  try {
    return { ...NO_NOTES, ...(JSON.parse(localStorage.getItem(NOTES_KEY) ?? '{}') as Partial<ReportNotes>) }
  } catch {
    return NO_NOTES
  }
}

/** One #print-root per page: index.css hides the app and shows only this while printing. */
function printRoot(): HTMLElement {
  let el = document.getElementById('print-root')
  if (!el) {
    el = document.createElement('div')
    el.id = 'print-root'
    document.body.appendChild(el)
  }
  return el
}

export function ReportsPage() {
  const { t } = useTranslation()
  const [params, setParams] = useSearchParams()
  const asked = params.get('doc') as ReportKind | null
  const kind: ReportKind = asked && REPORT_KINDS.includes(asked) ? asked : 'full'
  const [period, setPeriod] = useState<Period>('30d')
  // the three note boxes: a form whose values are mirrored to localStorage as you type
  const notesForm = useForm<ReportNotes>({ defaultValues: loadNotes() })
  const notes = useWatch({ control: notesForm.control }) as ReportNotes
  const [printing, setPrinting] = useState(false)
  const { input, loading } = useReportData(period)
  const farmName = useFarm((s) => s.farmName)
  const user = useAtomValue(currentUserAtom)

  useEffect(() => {
    try {
      localStorage.setItem(NOTES_KEY, JSON.stringify(notes))
    } catch {
      // storage unavailable — the notes still print this session
    }
  }, [notes])

  // Browsers name the saved PDF after the page title, so set it for the print and restore it after.
  const startPrint = useCallback(() => setPrinting(true), [])
  useEffect(() => {
    if (!printing) return
    const before = document.title
    document.title = reportFileName(kind)
    const done = () => {
      document.title = before
      setPrinting(false)
    }
    window.addEventListener('afterprint', done, { once: true })
    // two frames: let the portal paint before the print dialog snapshots the page
    const id = requestAnimationFrame(() => requestAnimationFrame(() => window.print()))
    return () => {
      cancelAnimationFrame(id)
      window.removeEventListener('afterprint', done)
      document.title = before
    }
  }, [printing, kind])

  const doc = <ReportDocument kind={kind} period={period} input={input} farmName={farmName} preparedBy={user?.name} notes={notes} />
  const editsNotes = kind === 'lessons' || kind === 'full'

  return (
    <div className="flex flex-col gap-5">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label={t('reports.pick')}>
        {REPORT_KINDS.map((k) => {
          const Icon = KIND_ICON[k]
          const on = k === kind
          return (
            <button
              key={k}
              type="button"
              aria-pressed={on}
              onClick={() => setParams({ doc: k }, { replace: true })}
              className={cn(
                'flex items-start gap-3 rounded-xl border bg-card p-3.5 text-left shadow-card transition-colors hover:border-primary/50',
                on && 'border-primary ring-2 ring-primary/25',
              )}
            >
              <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-xl', on ? 'bg-primary text-primary-foreground' : toneChip.ok)}>
                <Icon className="size-5" />
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="font-bold">{t(`reports.kinds.${k}.title`)}</span>
                <span className="text-[13px] leading-snug text-muted-foreground">{t(`reports.kinds.${k}.desc`)}</span>
              </span>
            </button>
          )
        })}
      </section>

      <section className="grid items-start gap-5 xl:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
        <div className="flex flex-col gap-5">
          <Panel title={t('reports.optionsTitle')} icon={FileDown} tone="info">
            {kind !== 'actions' ? (
              <div className="flex flex-col gap-1.5">
                <span className="text-[13px] font-semibold">{t('reports.period')}</span>
                <ChoiceChips
                  value={period}
                  onChange={setPeriod}
                  label={t('reports.period')}
                  options={PERIODS.map((p) => ({ value: p, label: t(`reports.periods.${p}`) }))}
                />
              </div>
            ) : (
              <p className="text-[13px] text-muted-foreground">{t('reports.actionsNow')}</p>
            )}
            <Button onClick={startPrint} disabled={loading || printing} className="w-full">
              <FileDown className="size-[18px]" />
              {t('reports.download')}
            </Button>
            <p className="flex gap-2 text-[12.5px] leading-snug text-muted-foreground">
              <Info className="mt-0.5 size-4 shrink-0" />
              {t('reports.howTo')}
            </p>
          </Panel>

          {editsNotes ? (
            <Panel title={t('reports.notes.title')} description={t('reports.notes.hint')} icon={GraduationCap} tone="warn">
              {(['worked', 'failed', 'next'] as const).map((k) => (
                <label key={k} className="flex flex-col gap-1.5 text-[13px] font-semibold">
                  {t(`reports.notes.${k}`)}
                  <textarea
                    rows={3}
                    {...notesForm.register(k)}
                    className="w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-[14px] font-normal outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                  />
                </label>
              ))}
            </Panel>
          ) : null}
        </div>

        <div className="overflow-x-auto rounded-xl border bg-muted/40 p-3 sm:p-5">
          <div className={cn('mx-auto max-w-[820px] rounded-lg bg-white p-5 shadow-card sm:p-8', loading && 'animate-pulse')} aria-busy={loading}>
            {doc}
          </div>
        </div>
      </section>

      {printing ? createPortal(doc, printRoot()) : null}
    </div>
  )
}
