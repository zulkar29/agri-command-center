import { Switch } from 'react-native'
import { C } from '@/lib/theme'

/** Themed switch matching the dashboard's green toggles. */
export function AppSwitch({
  value,
  onValueChange,
  disabled,
}: {
  value: boolean
  onValueChange: () => void
  disabled?: boolean
}) {
  return (
    <Switch
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      trackColor={{ false: '#cdd6cf', true: C.primary }}
      thumbColor="#ffffff"
      ios_backgroundColor="#cdd6cf"
    />
  )
}
