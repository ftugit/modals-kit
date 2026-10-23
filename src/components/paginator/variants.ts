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

export type PaginatorHostVariants = VariantProps<typeof paginatorHostVariants>
