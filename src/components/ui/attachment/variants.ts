import { variants, type VariantProps } from '#components/utils.js'

export const attachmentVariants = /* @__PURE__ */ variants(
  'relative max-w-full min-w-0 overflow-hidden border border-border bg-card text-card-foreground transition-colors select-none',
  {
    layout: {
      row: 'flex w-full items-center',
      tile: 'flex aspect-square flex-col justify-between',
    },
    size: {
      sm: 'rounded-md',
      md: 'rounded-lg',
      lg: 'rounded-xl',
    },
    state: {
      idle: 'border-dashed bg-muted/40',
      uploading: 'border-border bg-card',
      processing: 'border-border bg-card',
      error: 'border-destructive/40 bg-destructive/10',
      done: 'border-border bg-card',
    },
  },
  { layout: 'row', size: 'md', state: 'done' },
)

export type AttachmentVariants = VariantProps<typeof attachmentVariants>

export const attachmentRowSpacing: Record<'sm' | 'md' | 'lg', string> = {
  sm: 'min-h-14 gap-2.5 px-2.5 py-2',
  md: 'min-h-20 gap-3 px-3.5 py-2.5',
  lg: 'h-24 gap-4 px-4 py-3',
}

export const attachmentTileSize: Record<'sm' | 'md' | 'lg', string> = {
  sm: 'w-28',
  md: 'h-32',
  lg: 'w-44',
}

export const attachmentMediaVariants = /* @__PURE__ */ variants(
  'relative shrink-0 overflow-hidden flex items-center justify-center',
  {
    layout: {
      row: 'rounded-md',
      tile: 'w-full flex-1 min-h-0',
    },
    size: {
      sm: '',
      md: '',
      lg: '',
    },
    variant: {
      icon: 'bg-muted text-muted-foreground',
      image: 'bg-muted',
      error: 'bg-destructive/10 text-destructive',
    },
  },
  { layout: 'row', size: 'md', variant: 'icon' },
)

export const attachmentRowMediaSize: Record<'sm' | 'md' | 'lg', string> = {
  sm: 'size-9',
  md: 'size-10',
  lg: 'size-12',
}

export const attachmentIconSize: Record<'sm' | 'md' | 'lg', string> = {
  sm: 'size-4',
  md: 'size-5',
  lg: 'size-5',
}

export const attachmentTileIconSize: Record<'sm' | 'md' | 'lg', string> = {
  sm: 'size-5',
  md: 'size-8',
  lg: 'size-10',
}
