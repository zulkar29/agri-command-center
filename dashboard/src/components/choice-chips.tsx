import { ToggleGroup as ToggleGroupPrimitive } from 'radix-ui'
import { cn } from '@/lib/utils'

type Option<T extends string> = T | { value: T; label: string }

interface ChoiceChipsProps<T extends string> {
  value: T
  onChange: (v: T) => void
  options: readonly Option<T>[]
  /** accessible name of the group */
  label: string
  className?: string
  /** locks the choice (e.g. role permissions) */
  disabled?: boolean
}

// Radix reads an empty string as "nothing selected", so an option whose value is
// '' (a "None"/"Not linked" chip) would never show as active nor be re-selectable.
// Map it to a sentinel on the way in and back on the way out.
const EMPTY = '\u0000empty'
const enc = (v: string) => (v === '' ? EMPTY : v)
const dec = (v: string) => (v === EMPTY ? '' : v)

/** A single-choice group of buttons (radix ToggleGroup), used for filters, tabs and short forms. */
export function ChoiceChips<T extends string>({ value, onChange, options, label, className, disabled }: ChoiceChipsProps<T>) {
  return (
    <ToggleGroupPrimitive.Root
      type="single"
      value={enc(value)}
      disabled={disabled}
      onValueChange={(v) => {
        if (v) onChange(dec(v) as T)
      }}
      aria-label={label}
      className={cn('flex flex-wrap gap-2 disabled:opacity-50', className)}
    >
      {options.map((o) => {
        const v = typeof o === 'string' ? o : o.value
        const l = typeof o === 'string' ? o : o.label
        return (
          <ToggleGroupPrimitive.Item
            key={v}
            value={enc(v)}
            className="inline-flex h-11 items-center rounded-lg border border-input bg-card px-4 text-sm font-semibold text-foreground transition-colors outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/40 data-[state=on]:border-primary data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
          >
            {l}
          </ToggleGroupPrimitive.Item>
        )
      })}
    </ToggleGroupPrimitive.Root>
  )
}
