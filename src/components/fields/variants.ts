import { variants, type VariantProps } from '#components/utils.js'

export const fieldsSurfaceVariants = variants(
  'flex flex-col gap-4 border border-border',
  {
    surface: {
      card: 'rounded-xl bg-card p-6 text-card-foreground shadow-sm',
      row: 'rounded-lg bg-muted/20 p-4',
    },
  },
  {
    surface: 'card',
  },
)

export const fieldsLayoutVariants = variants(
  'grid',
  {
    layout: {
      pair: 'gap-3 sm:grid-cols-2',
      values: 'grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm',
    },
  },
  {
    layout: 'pair',
  },
)

export type FieldsSurfaceVariants = VariantProps<typeof fieldsSurfaceVariants>
export type FieldsLayoutVariants = VariantProps<typeof fieldsLayoutVariants>
