import {
  HindSiliguri_400Regular,
  HindSiliguri_500Medium,
  HindSiliguri_600SemiBold,
  HindSiliguri_700Bold,
  useFonts,
} from '@expo-google-fonts/hind-siliguri'

/** Same family the dashboard uses, bundled so Bangla renders consistently. */
export const F = {
  reg: 'HindSiliguri_400Regular',
  med: 'HindSiliguri_500Medium',
  semi: 'HindSiliguri_600SemiBold',
  bold: 'HindSiliguri_700Bold',
}

/** Load once in the root layout; keep rendering even if the fonts fail to
 * load (the system Bangla font is an acceptable fallback). */
export function useAppFonts(): boolean {
  const [loaded, error] = useFonts({
    HindSiliguri_400Regular,
    HindSiliguri_500Medium,
    HindSiliguri_600SemiBold,
    HindSiliguri_700Bold,
  })
  return loaded || !!error
}
