/* @unocss-include */
// Базовые классы полей, их размеры, контролы выбора и общая база кнопок-аффиксов.
import { variants, type VariantProps } from '../../../utils'

export const fieldBase =
  'w-full rounded-md border border-input bg-background text-foreground shadow-xs placeholder:text-muted-foreground transition-colors outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20'

export const controlBase =
  'relative shrink-0 cursor-pointer appearance-none border border-input bg-background shadow-xs transition-[color,background-color,border-color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20'

export const affixButtonClass =
  'inline-flex cursor-pointer items-center justify-center text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-50'

export const inputVariants = variants(
  fieldBase,
  { size: { sm: 'h-8 px-2.5 text-sm', md: 'h-9 px-3 text-sm', lg: 'h-10 px-3 text-sm' } },
  { size: 'md' },
)

export type InputVariants = VariantProps<typeof inputVariants>

/**
 * Ширина по содержимому (`autoWidth` у `Input` и `NumberField`): поле растёт с текстом
 * от `minChars` символов до ширины родителя. Это `field-sizing: content` — чистый CSS,
 * JS не нужен; браузер без него рисует поле родной ширины, значение то же.
 * Наименьшая ширина — `--field-min-width`, её ставит примитив.
 */
export const AUTO_WIDTH_CLASS =
  'field-sizing-content w-auto self-start max-w-full transition-[width] duration-200 ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:duration-[1ms]'
