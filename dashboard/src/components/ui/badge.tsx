import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-[12.5px] font-semibold whitespace-nowrap',
  {
    variants: {
      tone: {
        ok: 'border-success-line bg-success-soft text-success-ink',
        warn: 'border-warning-line bg-warning-soft text-warning-ink',
        bad: 'border-danger-line bg-danger-soft text-danger-ink',
        info: 'border-info-line bg-info-soft text-info-ink',
        neutral: 'border-border bg-muted text-foreground/80',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
)

function Badge({ className, tone, ...props }: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ tone }), className)} {...props} />
}

export { Badge }
