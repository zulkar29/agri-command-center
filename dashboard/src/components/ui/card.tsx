import * as React from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

function Card({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card"
      className={cn('flex min-w-0 flex-col gap-4 rounded-2xl border bg-card p-5 text-card-foreground shadow-card', className)}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="card-header" className={cn('flex flex-col gap-1', className)} {...props} />
}

function CardTitle({
  className,
  icon: Icon,
  children,
  ...props
}: React.ComponentProps<'h2'> & { icon?: LucideIcon }) {
  return (
    <h2 data-slot="card-title" className={cn('flex items-center gap-2.5 text-[17px] leading-snug font-bold', className)} {...props}>
      {Icon ? (
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent text-primary">
          <Icon className="size-[17px]" />
        </span>
      ) : null}
      {children}
    </h2>
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<'p'>) {
  return (
    <p data-slot="card-description" className={cn('text-[13px] leading-relaxed text-muted-foreground', className)} {...props} />
  )
}

export { Card, CardHeader, CardTitle, CardDescription }
