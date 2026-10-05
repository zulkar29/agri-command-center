import { Text, type TextProps, type TextStyle } from 'react-native'
import { F } from '@/lib/fonts'
import { C } from '@/lib/theme'

export type Weight = keyof typeof F

/** App-wide text: Hind Siliguri (the dashboard's Bangla font) by default. */
export function AppText({ weight = 'reg', style, ...rest }: TextProps & { weight?: Weight }) {
  const flattened = (Array.isArray(style) ? Object.assign({}, ...style) : style) ?? {}
  return (
    <Text
      {...rest}
      style={{ color: C.ink, fontSize: 15, fontFamily: F[weight], ...flattened } as TextStyle}
    />
  )
}
