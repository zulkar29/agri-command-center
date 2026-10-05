import { Controller, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { useAtomValue } from 'jotai'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardTitle } from '@/components/ui/card'
import { Field, FieldError, Input } from '@/components/ui/input'
import { useUpdateProfile } from '@/services/auth'
import { authSessionAtom, demoAtom } from '@/state/conn'

const PHONE_RE = /^\+?[0-9]{10,15}$/

interface ContactForm {
  phone: string
  chat: string
}

/** Where my alerts go: SMS number and Telegram chat id (any role, live mode only). */
export function ContactCard() {
  const { t } = useTranslation()
  const demo = useAtomValue(demoAtom)
  const session = useAtomValue(authSessionAtom)
  const { control, handleSubmit, formState } = useForm<ContactForm>({
    values: { phone: session?.user.phone ?? '', chat: session?.user.telegramChat ?? '' },
  })
  const save = useUpdateProfile(t('settings.contactSaved'), t('settings.contactInvalid'))
  if (demo || !session) return null

  const submit = handleSubmit((v) => save.mutate({ phone: v.phone.trim(), telegramChat: v.chat.trim() }))
  return (
    <Card style={{ gap: 12 }}>
      <CardTitle>{t('settings.contactTitle')}</CardTitle>
      <CardDescription>{t('settings.contactNote')}</CardDescription>
      <Field label={t('settings.phone')}>
        <Controller
          control={control}
          name="phone"
          rules={{ validate: (v) => v.trim() === '' || PHONE_RE.test(v.trim()) || t('settings.contactInvalid') }}
          render={({ field }) => (
            <Input value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} keyboardType="phone-pad" placeholder="+8801712345678" />
          )}
        />
        {formState.errors.phone ? <FieldError>{formState.errors.phone.message}</FieldError> : null}
      </Field>
      <Field label={t('settings.telegramChat')}>
        <Controller
          control={control}
          name="chat"
          render={({ field }) => <Input value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} autoCapitalize="none" />}
        />
      </Field>
      <Button busy={save.isPending} onPress={() => void submit()}>
        {t('settings.contactSave')}
      </Button>
    </Card>
  )
}
