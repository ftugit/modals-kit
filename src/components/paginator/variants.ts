/* @unocss-include */
import { variants, type VariantProps } from '#components/utils.js'

export const paginatorHostVariants = variants(
  'scroll-mt-20 overflow-y-auto rounded-xl border p-3',
  {
    variant: {
      default: 'border-border/70 bg-background',
      card: 'border-border bg-card shadow-sm',
    },
  },
  {
    variant: 'default',
  },
)

export const pageSliceVariants = variants(
  'text-xs text-muted-foreground',
  {
    floating: {
      none: 'mb-2 flex items-center gap-2',
      top: 'pointer-events-none sticky top-2 z-20 mb-2 flex justify-center',
      bottom: 'pointer-events-none sticky bottom-2 z-20 mt-2 flex justify-center',
    },
  },
  {
    floating: 'none',
  },
)

export const pageSliceSurfaceVariants = variants(
  'inline-flex max-w-full flex-wrap items-center justify-center gap-x-1.5 gap-y-0.5',
  {
    cloud: {
      false: '',
      true: 'pointer-events-auto rounded-full border border-border/80 bg-background/90 px-3.5 py-1.5 shadow-sm backdrop-blur',
    },
  },
  {
    cloud: false,
  },
)

export type PaginatorHostVariants = VariantProps<typeof paginatorHostVariants>
export type PageSliceVariants = VariantProps<typeof pageSliceVariants>
