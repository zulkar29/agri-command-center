import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toNum } from '@/lib/format'
import { useUpdateField } from '@/services/fields'
import type { Field } from '@/types'

interface EditForm {
  name: string
  crop: string
  area: string
  plants: string
  harvestAt: string
}

const nonNegative = (v: string) => toNum(v) >= 0

const toForm = (f: Field): EditForm => ({ name: f.name, crop: f.crop, area: String(f.area), plants: String(f.plants), harvestAt: String(f.harvestAt) })

/** Owner: correct a field's name, crop, area, plants or harvest day (live only). */
export function FieldEdit({ field }: { field: Field }) {
  const { t } = useTranslation()
  const update = useUpdateField()
  const [open, setOpen] = useState(false)
  const { register, handleSubmit, reset, formState } = useForm<EditForm>({
    defaultValues: toForm(field),
  })

  if (!open) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          // start from the field as it is now, not as it was when this row first rendered
          reset(toForm(field))
          setOpen(true)
        }}
      >
        {t('fields.edit')}
      </Button>
    )
  }

  const submit = handleSubmit((v) =>
    update.mutate(
      { id: field.id, name: v.name.trim(), crop: v.crop.trim(), area: toNum(v.area), plants: Math.round(toNum(v.plants)), harvestAt: Math.round(toNum(v.harvestAt)) },
      { onSuccess: () => setOpen(false) },
    ),
  )
  const cancel = () => {
    reset()
    setOpen(false)
  }
  const bad = formState.errors

  return (
    <form className="flex w-full flex-col gap-3 rounded-lg bg-muted/50 p-3" onSubmit={submit} noValidate>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`fe-name-${field.id}`}>{t('fields.name')}</Label>
          <Input id={`fe-name-${field.id}`} aria-invalid={!!bad.name} {...register('name', { validate: (v) => v.trim() !== '' })} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`fe-crop-${field.id}`}>{t('fields.crop')}</Label>
          <Input id={`fe-crop-${field.id}`} aria-invalid={!!bad.crop} {...register('crop', { validate: (v) => v.trim() !== '' })} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`fe-area-${field.id}`}>{t('fields.area')}</Label>
          <Input id={`fe-area-${field.id}`} inputMode="decimal" aria-invalid={!!bad.area} {...register('area', { validate: nonNegative })} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`fe-plants-${field.id}`}>{t('fields.plants')}</Label>
          <Input id={`fe-plants-${field.id}`} inputMode="numeric" aria-invalid={!!bad.plants} {...register('plants', { validate: nonNegative })} />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`fe-harvest-${field.id}`}>{t('fields.harvest')}</Label>
        <Input id={`fe-harvest-${field.id}`} inputMode="numeric" aria-invalid={!!bad.harvestAt} {...register('harvestAt', { validate: (v) => toNum(v) >= 1 })} />
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={update.isPending}>
          {t('fields.save')}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={cancel}>
          {t('fields.cancel')}
        </Button>
      </div>
    </form>
  )
}
