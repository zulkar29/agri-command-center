export type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'neutral'

/** Background color of a small status dot. */
export const toneDot: Record<Tone, string> = {
  ok: 'bg-success',
  warn: 'bg-warning',
  bad: 'bg-destructive',
  info: 'bg-info',
  neutral: 'bg-muted-foreground',
}

/** Fill color of a progress bar. */
export const toneBar: Record<Tone, string> = {
  ok: 'bg-success',
  warn: 'bg-warning',
  bad: 'bg-destructive',
  info: 'bg-info',
  neutral: 'bg-muted-foreground',
}

/** Stroke color of a ring gauge. */
export const toneRing: Record<Tone, string> = {
  ok: 'stroke-success',
  warn: 'stroke-warning',
  bad: 'stroke-destructive',
  info: 'stroke-info',
  neutral: 'stroke-muted-foreground',
}

/** Soft tinted background + ink for an icon chip. */
export const toneChip: Record<Tone, string> = {
  ok: 'bg-success-soft text-success-ink',
  warn: 'bg-warning-soft text-warning-ink',
  bad: 'bg-danger-soft text-danger-ink',
  info: 'bg-info-soft text-info-ink',
  neutral: 'bg-muted text-foreground/70',
}

/** Readable text color for a status word or number. */
export const toneText: Record<Tone, string> = {
  ok: 'text-success-ink',
  warn: 'text-warning-ink',
  bad: 'text-danger-ink',
  info: 'text-info-ink',
  neutral: 'text-muted-foreground',
}
