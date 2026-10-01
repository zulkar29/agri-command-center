import { useState } from 'react'
import { ChevronDown, FileDown, ListChecks, ListPlus, Plus, Trash2, TriangleAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Controller, useForm } from 'react-hook-form'
import { ChoiceChips } from '@/components/choice-chips'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { StatTile } from '@/components/stat-tile'
import { Card, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ASSIGNEES, DUES } from '@/data/constants'
import { bn, dateLabel, endOfDay } from '@/lib/format'
import { dueFor, isOverdue } from '@/lib/farm'
import { cn } from '@/lib/utils'
import { useCan } from '@/atoms/auth'
import { assigneeLabel, dueLabel } from '@/lib/labels'
import { useFields } from '@/services/fields'
import { useAddTask, useDeleteTask, useTasks, useToggleTask } from '@/services/tasks'
import type { Assignee, Due } from '@/types'

const FILTERS = ['all', 'pending', 'overdue', 'done'] as const
const REPEATS = [0, 7, 10, 15] as const // days; 0 = once
const PRIORITIES = ['normal', 'urgentPriority'] as const
type Filter = (typeof FILTERS)[number]
type Priority = (typeof PRIORITIES)[number]

interface TaskForm {
  text: string
  who: Assignee
  due: Due
  pri: Priority
  /** yyyy-mm-dd from the date input, '' = none */
  date: string
  repeat: (typeof REPEATS)[number]
  /** '' = not tied to a field */
  fieldId: string
}

export function TasksPage() {
  const { t } = useTranslation()
  const tasks = useTasks()
  const fields = useFields()
  const addTask = useAddTask()
  const toggleTask = useToggleTask()
  const deleteTask = useDeleteTask()
  const can = useCan()
  const [filter, setFilter] = useState<Filter>('all')
  const [more, setMore] = useState(false)

  const form = useForm<TaskForm>({
    defaultValues: { text: '', who: 'বাবা', due: 'আজ', pri: 'normal', date: '', repeat: 0, fieldId: '' },
  })
  const submit = form.handleSubmit((v) => {
    const dueAt = v.date ? endOfDay(v.date) : NaN
    const hasDeadline = !Number.isNaN(dueAt)
    addTask.mutate({
      text: v.text.trim(),
      who: v.who,
      // a deadline wins over the coarse label (the server derives the same)
      due: hasDeadline ? dueFor(dueAt) : v.due,
      urgent: v.pri === 'urgentPriority',
      ...(hasDeadline ? { dueAt } : {}),
      ...(v.repeat > 0 ? { repeatDays: v.repeat } : {}),
      ...(v.fieldId ? { fieldId: v.fieldId } : {}),
    })
    form.reset()
  })

  const visible = tasks.filter((x) =>
    filter === 'all' ? true : filter === 'pending' ? !x.done : filter === 'overdue' ? isOverdue(x) : x.done,
  )
  const doneCount = tasks.filter((t) => t.done).length

  const overdueCount = tasks.filter(isOverdue).length
  const pendingCount = tasks.length - doneCount
  const pct = tasks.length ? Math.round((doneCount / tasks.length) * 100) : 0
  const group = (children: React.ReactNode, label: string) => (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  )

  return (
    <div className="flex flex-col gap-6">
      <section className="grid gap-4 sm:grid-cols-3">
        <StatTile icon={ListChecks} tone="warn" label={t('tasks.pending')} value={bn(pendingCount)} note={t('tasks.progress', { done: bn(doneCount), total: bn(tasks.length) })} pct={pct} />
        <StatTile icon={TriangleAlert} tone={overdueCount ? 'bad' : 'ok'} label={t('tasks.overdue')} value={bn(overdueCount)} note={overdueCount ? t('tasks.overdueNote') : t('tasks.none')} />
        <StatTile icon={ListChecks} tone="ok" label={t('tasks.done')} value={bn(doneCount)} />
      </section>

      {can('tasks') ? (
        <Card>
          <CardTitle icon={ListPlus}>{t('tasks.addTitle')}</CardTitle>
          <form onSubmit={submit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="flex flex-1 flex-col gap-1.5">
                <Input
                  id="task-text"
                  aria-label={t('tasks.task')}
                  placeholder={t('tasks.taskPlaceholder')}
                  {...form.register('text', { required: t('tasks.taskRequired') })}
                />
                {form.formState.errors.text ? <p className="text-[13px] text-destructive">{form.formState.errors.text.message}</p> : null}
              </div>
              <Button type="submit" className="sm:self-start">
                <Plus /> {t('tasks.add')}
              </Button>
            </div>
            <button
              type="button"
              onClick={() => setMore((v) => !v)}
              aria-expanded={more}
              className="flex w-fit items-center gap-1.5 text-sm font-semibold text-primary outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
            >
              <ChevronDown className={cn('size-4 transition-transform', more && 'rotate-180')} />
              {more ? t('tasks.lessOptions') : t('tasks.moreOptions')}
            </button>
            {more ? (
              <div className="grid gap-4 border-t pt-4 md:grid-cols-2">
                {group(
                  <Controller control={form.control} name="who" render={({ field }) => (
                    <ChoiceChips value={field.value} onChange={field.onChange} options={ASSIGNEES.map((a) => ({ value: a, label: assigneeLabel(a) }))} label={t('tasks.who')} />
                  )} />,
                  t('tasks.who'),
                )}
                {group(
                  <Controller control={form.control} name="due" render={({ field }) => (
                    <ChoiceChips value={field.value} onChange={field.onChange} options={DUES.map((d) => ({ value: d, label: dueLabel(d) }))} label={t('tasks.when')} />
                  )} />,
                  t('tasks.when'),
                )}
                {group(<Input id="task-date" type="date" {...form.register('date')} />, t('tasks.deadline'))}
                {group(
                  <Controller control={form.control} name="repeat" render={({ field }) => (
                    <ChoiceChips value={String(field.value)} onChange={(v) => field.onChange(Number(v))} options={REPEATS.map((n) => ({ value: String(n), label: n === 0 ? t('tasks.repeatNone') : t('tasks.repeatEvery', { n: bn(n) }) }))} label={t('tasks.repeat')} />
                  )} />,
                  t('tasks.repeat'),
                )}
                {fields.length > 0
                  ? group(
                      <Controller control={form.control} name="fieldId" render={({ field }) => (
                        <ChoiceChips value={field.value} onChange={field.onChange} options={[{ value: '', label: t('tasks.noField') }, ...fields.map((f) => ({ value: f.id, label: f.name }))]} label={t('tasks.field')} />
                      )} />,
                      t('tasks.field'),
                    )
                  : null}
                {group(
                  <Controller control={form.control} name="pri" render={({ field }) => (
                    <ChoiceChips value={field.value} onChange={field.onChange} options={PRIORITIES.map((p) => ({ value: p, label: t(`tasks.${p}`) }))} label={t('tasks.priority')} />
                  )} />,
                  t('tasks.priority'),
                )}
              </div>
            ) : null}
          </form>
        </Card>
      ) : null}

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle icon={ListChecks}>{t('tasks.title')}</CardTitle>
          <Button asChild variant="outline" size="sm">
            <Link to="/reports?doc=actions">
              <FileDown className="size-4" />
              {t('common.pdf')}
            </Link>
          </Button>
          <ChoiceChips
            value={filter}
            onChange={setFilter}
            options={FILTERS.map((f) => ({ value: f, label: t(`tasks.${f}`) }))}
            label={t('tasks.filter')}
          />
        </div>
        {visible.length === 0 ? <p className="text-[13px] text-muted-foreground">{t('tasks.empty')}</p> : null}
        <div className="flex flex-col">
          {visible.map((row) => (
            <div
              key={row.id}
              className={cn(
                'flex items-center gap-3 border-t py-3.5 first:border-t-0',
                isOverdue(row) && 'rounded-lg border-t-0 bg-danger-soft/50 px-3 [&+div]:border-t-0',
              )}
            >
              <Checkbox checked={row.done} onCheckedChange={() => toggleTask.mutate(row)} disabled={!can('tasks')} aria-label={row.text} />
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <span className={cn('leading-snug font-medium', row.done && 'text-muted-foreground line-through')}>{row.text}</span>
                <div className="flex flex-wrap gap-1.5">
                  <Badge>{assigneeLabel(row.who)}</Badge>
                  {row.dueAt ? (
                    <Badge tone={isOverdue(row) ? 'bad' : row.due === 'আজ' ? 'info' : 'neutral'}>
                      {isOverdue(row) ? `${t('tasks.overdue')} · ` : ''}
                      {dateLabel(row.dueAt)}
                    </Badge>
                  ) : (
                    <Badge tone={row.due === 'আজ' ? 'info' : 'neutral'}>{dueLabel(row.due)}</Badge>
                  )}
                  {row.repeatDays ? <Badge>{t('tasks.repeatEvery', { n: bn(row.repeatDays) })}</Badge> : null}
                  {row.fieldId ? <Badge>{fields.find((f) => f.id === row.fieldId)?.name ?? row.fieldId}</Badge> : null}
                  {row.urgent ? <Badge tone="bad">{t('tasks.urgent')}</Badge> : null}
                </div>
              </div>
              {can('tasks') ? (
                <Button variant="ghost" size="icon" className="size-9 text-danger-ink hover:bg-danger-soft" onClick={() => deleteTask.mutate(row)} aria-label={t('tasks.deleteTask', { text: row.text })}>
                  <Trash2 className="size-[18px]" />
                </Button>
              ) : null}
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}
