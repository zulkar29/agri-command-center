import { useTranslation } from 'react-i18next'
import { bn, fmt } from '@/lib/format'
import { catLabel } from '@/lib/labels'
import {
  buildActions,
  buildLessons,
  buildPnl,
  money,
  type CatShare,
  type Period,
  type Pnl,
  type ReportInput,
  type ReportKind,
} from '@/lib/report'
import { toneBar, toneDot } from '@/lib/tone'
import { cn } from '@/lib/utils'

export interface ReportNotes {
  worked: string
  failed: string
  next: string
}

interface Props {
  kind: ReportKind
  period: Period
  input: ReportInput
  farmName: string
  preparedBy?: string
  notes: ReportNotes
}

const dateText = (at: number, lang: string) =>
  new Date(at).toLocaleDateString(lang.startsWith('bn') ? 'bn-BD' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' })

/**
 * The paper version of a report. It is rendered twice: as the on-screen
 * preview and, while printing, into #print-root (see index.css `@media
 * print`). Everything in it is plain HTML/CSS — no canvas, no charts — so the
 * browser's "Save as PDF" keeps Bangla text selectable and crisp.
 */
export function ReportDocument({ kind, period, input, farmName, preparedBy, notes }: Props) {
  const { t, i18n } = useTranslation()
  const pnl = buildPnl(input.finance)
  const actions = buildActions(input)
  const lessons = buildLessons(input)
  const showPnl = kind === 'pnl' || kind === 'full'
  const showActions = kind === 'actions' || kind === 'full'
  const showLessons = kind === 'lessons' || kind === 'full'
  const from = period === 'all' ? t('reports.beginning') : dateText(input.range.from, i18n.language)
  const range = `${from} – ${dateText(input.range.to, i18n.language)}`

  return (
    <article className="report-doc text-[13px] leading-relaxed text-[#1a2a21]">
      <header className="flex items-start justify-between gap-4 border-b-2 border-[#1b6b43] pb-3">
        <div>
          <p className="text-[11px] font-bold tracking-wider text-[#1b6b43] uppercase">{t('app.name')}</p>
          <h1 className="text-[24px] leading-tight font-bold">{t(`reports.kinds.${kind}.title`)}</h1>
          <p className="text-[13px] text-[#646b62]">{farmName}</p>
        </div>
        <dl className="text-right text-[12px] text-[#646b62]">
          {kind !== 'actions' ? (
            <>
              <dt className="font-semibold">{t('reports.period')}</dt>
              <dd className="mb-1">{range}</dd>
            </>
          ) : null}
          <dt className="font-semibold">{t('reports.generated')}</dt>
          <dd>{dateText(input.now, i18n.language)}</dd>
          {preparedBy ? <dd>{t('reports.preparedBy', { name: preparedBy })}</dd> : null}
        </dl>
      </header>

      {kind === 'full' ? <Summary pnl={pnl} input={input} actionCount={actions.length} /> : null}
      {showPnl ? <PnlSection pnl={pnl} /> : null}
      {showActions ? <ActionSection items={actions} /> : null}
      {showLessons ? <LessonSection lessons={lessons} notes={notes} /> : null}

      <footer className="report-footer mt-8 border-t pt-2 text-[11px] text-[#646b62]">{t('reports.footer')}</footer>
    </article>
  )
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="report-section mt-6">
      <h2 className="border-l-4 border-[#d19a1e] pl-2.5 text-[16px] font-bold">{title}</h2>
      {hint ? <p className="report-hint mt-1 pl-3.5 text-[12px] text-[#646b62]">{hint}</p> : null}
      <div className="mt-3">{children}</div>
    </section>
  )
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' }) {
  return (
    <div className="flex-1 basis-[120px] rounded-lg border border-[#e6e2d4] p-2.5">
      <p className="text-[11px] text-[#646b62]">{label}</p>
      <p className={cn('text-[20px] leading-tight font-bold', tone === 'good' && 'text-[#1f7a4d]', tone === 'bad' && 'text-[#c0392b]')}>{value}</p>
    </div>
  )
}

/** Executive summary on the full report: the verdict in a few lines. */
function Summary({ pnl, input, actionCount }: { pnl: Pnl; input: ReportInput; actionCount: number }) {
  const { t } = useTranslation()
  const open = input.tasks.filter((x) => !x.done).length
  return (
    <Section title={t('reports.summary')}>
      <div className="flex flex-wrap gap-2.5">
        <Figure label={t('finance.profitLoss')} value={money(pnl.profit)} tone={pnl.profit < 0 ? 'bad' : 'good'} />
        <Figure label={t('reports.fieldsCount')} value={bn(input.fields.length)} />
        <Figure label={t('reports.openTasks')} value={bn(open)} />
        <Figure label={t('reports.actionCount')} value={bn(actionCount)} tone={actionCount > 0 ? 'bad' : 'good'} />
      </div>
    </Section>
  )
}

function Bars({ rows, tone }: { rows: CatShare[]; tone: 'ok' | 'warn' }) {
  if (rows.length === 0) return <p className="text-[#646b62]">—</p>
  return (
    <ul className="flex flex-col gap-1.5">
      {rows.map((r) => (
        <li key={r.cat} className="report-row">
          <div className="flex justify-between gap-3">
            <span>{catLabel(r.cat)}</span>
            <span className="font-semibold">
              ৳ {fmt(r.amount)} <span className="font-normal text-[#646b62]">· {bn(r.pct)}%</span>
            </span>
          </div>
          <div className="mt-0.5 h-1.5 rounded-full bg-[#efece3]">
            <div className={cn('h-full rounded-full', toneBar[tone])} style={{ width: `${Math.max(2, r.pct)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  )
}

function PnlSection({ pnl }: { pnl: Pnl }) {
  const { t } = useTranslation()
  const empty = pnl.income === 0 && pnl.expense === 0
  return (
    <Section title={t('reports.pnl.title')} hint={t('reports.pnl.hint')}>
      <div className="flex flex-wrap gap-2.5">
        <Figure label={t('finance.totalIncome')} value={`৳ ${fmt(pnl.income)}`} />
        <Figure label={t('finance.totalExpense')} value={`৳ ${fmt(pnl.expense)}`} />
        <Figure label={t('finance.profitLoss')} value={money(pnl.profit)} tone={pnl.profit < 0 ? 'bad' : 'good'} />
        <Figure label={t('reports.pnl.margin')} value={pnl.margin == null ? '—' : `${pnl.margin < 0 ? '−' : ''}${bn(Math.abs(pnl.margin))}%`} />
      </div>
      {empty ? (
        <p className="mt-3 text-[#646b62]">{t('reports.pnl.empty')}</p>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-2 gap-6 max-sm:grid-cols-1">
            <div>
              <h3 className="mb-1.5 font-bold">{t('reports.pnl.expenseBy')}</h3>
              <Bars rows={pnl.expenseShares} tone="warn" />
            </div>
            <div>
              <h3 className="mb-1.5 font-bold">{t('reports.pnl.incomeBy')}</h3>
              <Bars rows={pnl.incomeShares} tone="ok" />
            </div>
          </div>
          {pnl.fields.length > 0 ? (
            <div className="report-row mt-4">
              <h3 className="mb-1.5 font-bold">{t('reports.pnl.byField')}</h3>
              <table className="w-full border-collapse text-[12.5px]">
                <thead>
                  <tr className="border-b border-[#d3cfc0] text-left text-[#646b62]">
                    <th className="py-1 pr-2 font-semibold">{t('reports.pnl.field')}</th>
                    <th className="px-2 py-1 text-right font-semibold">{t('finance.income')}</th>
                    <th className="px-2 py-1 text-right font-semibold">{t('finance.expense')}</th>
                    <th className="px-2 py-1 text-right font-semibold">{t('finance.profitLoss')}</th>
                    <th className="py-1 pl-2 text-right font-semibold">{t('reports.pnl.perShotok')}</th>
                  </tr>
                </thead>
                <tbody>
                  {pnl.fields.map((f) => (
                    <tr key={f.fieldId || 'untagged'} className="border-b border-[#efece3]">
                      <td className="py-1 pr-2">
                        {f.fieldId ? f.name : t('fieldProfit.untagged')}
                        {f.crop ? <span className="text-[#646b62]"> · {f.crop}</span> : null}
                      </td>
                      <td className="px-2 py-1 text-right">৳ {fmt(f.income)}</td>
                      <td className="px-2 py-1 text-right">৳ {fmt(f.expense)}</td>
                      <td className={cn('px-2 py-1 text-right font-bold', f.profit < 0 ? 'text-[#c0392b]' : 'text-[#1f7a4d]')}>{money(f.profit)}</td>
                      <td className="py-1 pl-2 text-right">{f.profitPerShotok == null ? '—' : money(f.profitPerShotok)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </>
      )}
    </Section>
  )
}

function ActionSection({ items }: { items: ReturnType<typeof buildActions> }) {
  const { t } = useTranslation()
  return (
    <Section title={t('reports.actions.title')} hint={t('reports.actions.hint')}>
      {items.length === 0 ? (
        <p className="text-[#646b62]">{t('reports.actions.empty')}</p>
      ) : (
        <ul className="flex flex-col">
          {items.map((a) => (
            <li key={a.id} className="report-row flex items-start gap-2.5 border-b border-[#efece3] py-1.5">
              <span className="mt-0.5 size-3.5 shrink-0 rounded-[3px] border-[1.5px] border-[#646b62]" aria-hidden />
              <span className={cn('mt-[7px] size-2 shrink-0 rounded-full', toneDot[a.tone])} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="mr-1.5 text-[11px] font-semibold text-[#646b62] uppercase">{a.area}</span>
                {a.text}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

function LessonSection({ lessons, notes }: { lessons: ReturnType<typeof buildLessons>; notes: ReportNotes }) {
  const { t } = useTranslation()
  const blocks: { key: keyof ReportNotes; label: string }[] = [
    { key: 'worked', label: t('reports.notes.worked') },
    { key: 'failed', label: t('reports.notes.failed') },
    { key: 'next', label: t('reports.notes.next') },
  ]
  return (
    <Section title={t('reports.lessons.title')} hint={t('reports.lessons.hint')}>
      {lessons.length === 0 ? (
        <p className="text-[#646b62]">{t('reports.lessons.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {lessons.map((l) => (
            <li key={l.id} className="report-row flex gap-2.5 rounded-lg border border-[#e6e2d4] p-2.5">
              <span className={cn('mt-[7px] size-2 shrink-0 rounded-full', toneDot[l.tone])} aria-hidden />
              <div>
                <p className="font-bold">{l.title}</p>
                <p className="text-[#646b62]">{l.detail}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
      <h3 className="mt-5 mb-2 font-bold">{t('reports.notes.title')}</h3>
      <div className="grid grid-cols-1 gap-3">
        {blocks.map((b) => (
          <div key={b.key} className="report-row rounded-lg border border-[#e6e2d4] p-2.5">
            <p className="text-[12px] font-semibold text-[#646b62]">{b.label}</p>
            {notes[b.key].trim() ? (
              <p className="mt-1 whitespace-pre-wrap">{notes[b.key]}</p>
            ) : (
              // empty → ruled lines to write on after printing
              <div className="mt-1 h-[66px] bg-[repeating-linear-gradient(transparent,transparent_21px,#d3cfc0_21px,#d3cfc0_22px)]" />
            )}
          </div>
        ))}
      </div>
    </Section>
  )
}
