// Базовые классы полей и их размеры. Перенесено из `input.tsx` оригинала
// без правок значений: плану запрещено подбирать оформление.
import { variants, type VariantProps } from '../cn'

const fieldBase = 'w-full rounded-md border border-input bg-background text-foreground shadow-xs placeholder:text-muted-foreground transition-colors outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20'

export const inputVariants = variants(
  fieldBase,
  { size: { sm: 'h-8 px-2.5 text-sm', md: 'h-9 px-3 text-sm', lg: 'h-10 px-3 text-sm' } },
  { size: 'md' },
)

export type InputVariants = VariantProps<typeof inputVariants>
