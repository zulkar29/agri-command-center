import { useEffect, useState } from 'react'
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { router } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
// lowercase path: the package's root-level re-export shim is providers/google.js
import * as Google from 'expo-auth-session/providers/google'
import { Controller, useForm } from 'react-hook-form'
import { AppText } from '@/components/ui/text'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Field, FieldError, Input } from '@/components/ui/input'
import { C } from '@/lib/theme'
import i18n from '@/i18n'
import { probeGoogleClientId } from '@/services/auth'
import { connectGoogle, connectServer, startDemo } from '@/state/conn'

interface ConnectForm {
  url: string
  email: string
  password: string
}

/**
 * First-launch screen: point the app at the farm's Go server (docker compose
 * up, then the computer's LAN address) and log in with email+password or
 * Google, or explore with the built-in demo. The Google button appears once
 * the typed server reports a GOOGLE_CLIENT_ID (checked on URL blur).
 */
export default function ConnectScreen() {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [googleClientId, setGoogleClientId] = useState('')

  const { control, handleSubmit, getValues } = useForm<ConnectForm>({
    defaultValues: { url: '', email: '', password: '' },
  })

  const [googleRequest, googleResponse, promptGoogle] = Google.useIdTokenAuthRequest({
    clientId: googleClientId,
  })

  const connect = handleSubmit(async ({ url, email, password }) => {
    setBusy(true)
    setError('')
    try {
      await connectServer(url, email.trim(), password)
      router.replace('/')
    } catch (e) {
      setError(e instanceof Error ? e.message : t('m.connect.notFound'))
    } finally {
      setBusy(false)
    }
  })

  // Google answers here: verify with the backend, then connect like a
  // password login would have. State updates live in the async chain, not in
  // the effect body, to avoid cascading renders.
  useEffect(() => {
    if (googleResponse?.type !== 'success') return
    const idToken = (googleResponse.params as Record<string, string | undefined>)?.id_token
    const url = getValues('url').trim()
    if (!idToken || !url) return
    void (async () => {
      setBusy(true)
      setError('')
      try {
        await connectGoogle(url, idToken)
        router.replace('/')
      } catch (e) {
        // i18n.t (not the hook's t) so the effect needs no `t` dependency
        setError(e instanceof Error ? e.message : i18n.t('m.connect.googleFailed'))
      } finally {
        setBusy(false)
      }
    })()
  }, [googleResponse, getValues])

  /** Silently ask the typed server whether Google login is available. */
  const checkGoogle = async (url: string) => {
    const u = url.trim()
    if (u) setGoogleClientId(await probeGoogleClientId(u))
  }

  const demo = () => {
    startDemo()
    router.replace('/')
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, padding: 20, justifyContent: 'center' }} keyboardShouldPersistTaps="handled">
          <View style={{ alignItems: 'center', gap: 10, marginBottom: 22 }}>
            <View
              style={{
                width: 76,
                height: 76,
                borderRadius: 22,
                backgroundColor: C.primary,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <AppText style={{ fontSize: 38 }}>🌱</AppText>
            </View>
            <AppText weight="bold" style={{ fontSize: 26 }}>{t('app.name')}</AppText>
            <AppText style={{ fontSize: 14, color: C.muted, textAlign: 'center' }}>
              {t('m.connect.tagline')}
            </AppText>
          </View>

          <Card style={{ gap: 14 }}>
            <Field
              label={t('m.connect.serverAddr')}
              hint={t('m.connect.serverHint')}
            >
              <Controller
                control={control}
                name="url"
                rules={{
                  required: t('m.connect.urlRequired'),
                  validate: (v) => !/\s/.test(v.trim()) || t('m.connect.urlNoSpaces'),
                }}
                render={({ field: { value, onChange, onBlur } }) => (
                  <Input
                    value={value}
                    onChangeText={onChange}
                    onBlur={() => {
                      onBlur()
                      void checkGoogle(value)
                    }}
                    placeholder="http://192.168.0.5:8082"
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="url"
                    returnKeyType="next"
                  />
                )}
              />
            </Field>
            <Field label={t('login.email')}>
              <Controller
                control={control}
                name="email"
                rules={{
                  required: t('m.connect.emailRequired'),
                  pattern: { value: /^\S+@\S+\.\S+$/, message: t('m.connect.emailInvalid') },
                }}
                render={({ field: { value, onChange, onBlur } }) => (
                  <Input
                    value={value}
                    onChangeText={onChange}
                    onBlur={onBlur}
                    placeholder="owner@farm.com"
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="email-address"
                    returnKeyType="next"
                  />
                )}
              />
            </Field>
            <Field label={t('login.password')} hint={`${t('login.demoTitle')} ${t('login.demoAccounts')}`}>
              <Controller
                control={control}
                name="password"
                rules={{ required: t('m.connect.passwordRequired') }}
                render={({ field: { value, onChange, onBlur } }) => (
                  <Input
                    value={value}
                    onChangeText={onChange}
                    onBlur={onBlur}
                    placeholder="••••••••"
                    secureTextEntry
                    returnKeyType="go"
                    onSubmitEditing={connect}
                  />
                )}
              />
              {error ? (
                <FieldError>{error}</FieldError>
              ) : null}
            </Field>
            <Button onPress={connect} busy={busy}>{t('m.connect.submit')}</Button>

            {googleClientId ? (
              <>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <View style={{ flex: 1, height: 1, backgroundColor: C.border }} />
                  <AppText style={{ fontSize: 12, color: C.muted }}>{t('common.or')}</AppText>
                  <View style={{ flex: 1, height: 1, backgroundColor: C.border }} />
                </View>
                <Button
                  variant="outline"
                  disabled={!googleRequest}
                  onPress={() => void promptGoogle()}
                >
                  {t('m.connect.google')}
                </Button>
              </>
            ) : null}

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ flex: 1, height: 1, backgroundColor: C.border }} />
              <AppText style={{ fontSize: 12, color: C.muted }}>{t('common.or')}</AppText>
              <View style={{ flex: 1, height: 1, backgroundColor: C.border }} />
            </View>
            <Button variant="outline" onPress={demo}>{t('login.demoMode')}</Button>
          </Card>

          <Card style={{ marginTop: 12, gap: 6 }}>
            <AppText weight="semi" style={{ fontSize: 14 }}>{t('m.connect.noServerTitle')}</AppText>
            <AppText style={{ fontSize: 13, color: C.muted, lineHeight: 20 }}>
              {t('m.connect.noServerBody')}
            </AppText>
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}
