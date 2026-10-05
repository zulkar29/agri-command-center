import { Pressable, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { Controller, useForm } from 'react-hook-form'
import { Screen } from '@/components/screen'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardTitle } from '@/components/ui/card'
import { ChoiceChips } from '@/components/ui/chips'
import { Field, FieldError, Input } from '@/components/ui/input'
import { AppSwitch } from '@/components/ui/switch'
import { AppText } from '@/components/ui/text'
import { ASSIGNEES, DUES } from '@/lib/constants'
import { endOfDayIn, isOverdue } from '@/lib/farm'
import { bn, dateLabel } from '@/lib/format'
import { C, R } from '@/lib/theme'
import type { Assignee, Due, Task } from '@/lib/types'
import { useTranslation } from 'react-i18next'
import { assigneeLabel, dueLabel } from '@/lib/labels'
import { useFields } from '@/services/fields'
import { useAddTask, useDeleteTask, useTasks, useToggleTask } from '@/services/tasks'
import { useCan } from '@/state/conn'
import { outboxAtom } from '@/state/outbox'
import { pendingIds } from '@/lib/outbox'
import { useAtomValue } from 'jotai'

const DUE_TONE: Record<Due, 'warn' | 'info' | 'neutral'> = { আজ: 'warn', কাল: 'info', 'এই সপ্তাহ': 'neutral', পরে: 'neutral' }
/** The "when" chips set a real deadline: the end of that day, this many days out. */
const DUE_DAYS: Record<Due, number> = { আজ: 0, কাল: 1, 'এই সপ্তাহ': 7, পরে: 14 }
const REPEATS = [0, 7, 10, 15] as const // days; 0 = once

interface TaskForm {
  text: string
  who: Assignee
  due: Due
  urgent: boolean
  repeat: (typeof REPEATS)[number]
  /** '' = not tied to a field */
  fieldId: string
}

/** কাজ: কে কী করবে তার তালিকা। */
export default function TasksScreen() {
  const { t } = useTranslation()
  const tasks = useTasks()
  const fields = useFields()
  const waiting = pendingIds(useAtomValue(outboxAtom))
  const addTask = useAddTask()
  const toggleTask = useToggleTask()
  const deleteTask = useDeleteTask()
  const can = useCan()

  const form = useForm<TaskForm>({ defaultValues: { text: '', who: 'আমি', due: 'আজ', urgent: false, repeat: 0, fieldId: '' } })
  const submit = form.handleSubmit((v) => {
    addTask.mutate({
      text: v.text.trim(),
      who: v.who,
      due: v.due,
      urgent: v.urgent,
      dueAt: endOfDayIn(DUE_DAYS[v.due]),
      ...(v.repeat > 0 ? { repeatDays: v.repeat } : {}),
      ...(v.fieldId ? { fieldId: v.fieldId } : {}),
    })
    form.reset()
  })

  const pending = tasks.filter((t) => !t.done)
  const done = tasks.filter((t) => t.done)

  const row = (x: Task) => (
    <View
      key={x.id}
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 10,
        borderTopWidth: 1,
        borderTopColor: C.border,
        paddingTop: 10,
        opacity: x.done ? 0.55 : 1,
      }}
    >
      <Pressable
        onPress={() => toggleTask.mutate(x)}
        disabled={!can('tasks')}
        accessibilityLabel={x.done ? t('tasks.markUndone') : t('tasks.markDone')}
        hitSlop={6}
        style={{
          width: 24,
          height: 24,
          borderRadius: 12,
          borderWidth: 2,
          borderColor: x.done ? C.primary : C.input,
          backgroundColor: x.done ? C.primary : 'transparent',
          alignItems: 'center',
          justifyContent: 'center',
          marginTop: 1,
        }}
      >
        {x.done ? <Ionicons name="checkmark" size={14} color={C.onPrimary} /> : null}
      </Pressable>
      <View style={{ flex: 1, gap: 5 }}>
        <AppText weight={x.done ? 'reg' : 'med'} style={{ textDecorationLine: x.done ? 'line-through' : 'none', lineHeight: 21 }}>
          {x.text}
        </AppText>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          <Badge>{assigneeLabel(x.who)}</Badge>
          {x.dueAt ? (
            <Badge t={isOverdue(x) ? 'bad' : DUE_TONE[x.due]}>
              {isOverdue(x) ? `${t('tasks.overdue')} · ` : ''}
              {dateLabel(x.dueAt)}
            </Badge>
          ) : (
            <Badge t={DUE_TONE[x.due]}>{dueLabel(x.due)}</Badge>
          )}
          {x.repeatDays ? <Badge>{t('tasks.repeatEvery', { n: bn(x.repeatDays) })}</Badge> : null}
          {x.fieldId ? <Badge>{fields.find((f) => f.id === x.fieldId)?.name ?? x.fieldId}</Badge> : null}
          {x.urgent ? <Badge t="bad">{t('tasks.urgent')}</Badge> : null}
          {waiting.has(x.id) ? <Badge t="info">{t('m.offline.pending')}</Badge> : null}
        </View>
      </View>
      {can('tasks') ? (
        <Pressable
          onPress={() => deleteTask.mutate(x)}
          accessibilityLabel={t('tasks.deleteTask', { text: x.text })}
          hitSlop={8}
          style={({ pressed }) => ({
            width: 32,
            height: 32,
            borderRadius: R.md,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: pressed ? C.badSoft : 'transparent',
          })}
        >
          <Ionicons name="trash-outline" size={17} color={C.bad} />
        </Pressable>
      ) : null}
    </View>
  )

  return (
    <Screen title={t('nav.tasks.label')} sub={t('m.tasksSub', { pending: bn(pending.length), done: bn(done.length) })}>
      {can('tasks') ? (
      <Card style={{ gap: 12 }}>
        <CardTitle>{t('tasks.addTitle')}</CardTitle>
        <Field label={t('tasks.task')}>
          <Controller
            control={form.control}
            name="text"
            rules={{ required: t('tasks.taskRequired') }}
            render={({ field: { value, onChange, onBlur } }) => (
              <Input
                value={value}
                onChangeText={onChange}
                onBlur={onBlur}
                placeholder={t('tasks.taskPlaceholder')}
                returnKeyType="done"
                onSubmitEditing={submit}
              />
            )}
          />
          {form.formState.errors.text ? <FieldError>{form.formState.errors.text.message}</FieldError> : null}
        </Field>
        <Field label={t('tasks.who')}>
          <Controller
            control={form.control}
            name="who"
            render={({ field: { value, onChange } }) => (
              <ChoiceChips value={value} onChange={onChange} options={ASSIGNEES.map((a) => ({ value: a, label: assigneeLabel(a) }))} />
            )}
          />
        </Field>
        <Field label={t('tasks.when')}>
          <Controller
            control={form.control}
            name="due"
            render={({ field: { value, onChange } }) => (
              <ChoiceChips value={value} onChange={onChange} options={DUES.map((d) => ({ value: d, label: dueLabel(d) }))} />
            )}
          />
        </Field>
        <Field label={t('tasks.repeat')}>
          <Controller
            control={form.control}
            name="repeat"
            render={({ field: { value, onChange } }) => (
              <ChoiceChips
                value={String(value)}
                onChange={(v) => onChange(Number(v))}
                options={REPEATS.map((n) => ({
                  value: String(n),
                  label: n === 0 ? t('tasks.repeatNone') : t('tasks.repeatEvery', { n: bn(n) }),
                }))}
              />
            )}
          />
        </Field>
        {fields.length > 0 ? (
          <Field label={t('tasks.field')}>
            <Controller
              control={form.control}
              name="fieldId"
              render={({ field: { value, onChange } }) => (
                <ChoiceChips
                  value={value}
                  onChange={onChange}
                  options={[{ value: '', label: t('tasks.noField') }, ...fields.map((f) => ({ value: f.id, label: f.name }))]}
                />
              )}
            />
          </Field>
        ) : null}
        <Controller
          control={form.control}
          name="urgent"
          render={({ field: { value, onChange } }) => (
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <AppText weight="semi">{t('tasks.priority')}</AppText>
              <AppSwitch value={value} onValueChange={() => onChange(!value)} />
            </View>
          )}
        />
        <Button onPress={submit} busy={addTask.isPending}>
          {t('tasks.add')}
        </Button>
      </Card>
      ) : null}

      <Card>
        <CardTitle>{t('tasks.pending')}</CardTitle>
        {pending.length === 0 ? (
          <AppText style={{ fontSize: 13, color: C.muted }}>{t('tasks.allDone')}</AppText>
        ) : (
          pending.map(row)
        )}
      </Card>

      {done.length > 0 ? (
        <Card>
          <CardTitle>{t('tasks.done')}</CardTitle>
          {done.map(row)}
        </Card>
      ) : null}
    </Screen>
  )
}
