/* @unocss-include */
import { variants, type VariantProps } from '../cn'
import {
  MODAL_BACKDROP_CLASS,
  MODAL_CLOSE_ANIMATION_CLASSES,
  MODAL_OPEN_ANIMATION_CLASSES,
  MODAL_POPUP_CLASS,
} from '#lib/modals/svelte/classes.js'

/**
 * CVA-наборы модальных примитивов.
 *
 * Всё оформление — атомарные утилиты UnoCSS/presetWind4; CSS-файла у
 * модальной системы нет вовсе. Маркер-классов тоже: снаружи система видна
 * по data-атрибутам (`data-modal-link`, `data-modal-btn`,
 * `data-modal-popup`…), их ставят компоненты.
 *
 * Общие части оболочки/фона берутся из `#lib/modals/svelte/classes.js` —
 * там их видит и сам хост (`ModalHost`), поэтому источник правды один.
 *
 * `@unocss-include` нужен по той же причине, что и в `classes.ts`: UnoCSS
 * по умолчанию сканирует разметку, а не .ts-модули, и без пометки все
 * классы ниже остались бы строками в JS — без единого правила в CSS.
 */

/* Общая геометрия кнопок и триггеров: 36px минимум, паддинги 8/12,
   размер шрифта, переход по background/color/opacity и фокусное кольцо. */
const ACTION_BASE =
  'inline-flex min-h-9 items-center justify-center gap-1.5 rounded-[calc(var(--radius)-2px)] px-3 py-2 text-sm font-medium leading-none no-underline [transition:background_150ms_ease,color_150ms_ease,opacity_150ms_ease] focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2'

export const modalBackdropVariants = variants(MODAL_BACKDROP_CLASS, {}, {})

/**
 * Оболочка стопки. `openAnimation`/`closeAnimation` подставляют классы
 * состояний первого и последнего кадра (`data-starting-style` /
 * `data-ending-style` ставит хост); `stackAnimation` в разметке не участвует —
 * стопку целиком считает `tailStyle()` в JS (классов для неё не было и раньше).
 */
export const modalPopupVariants = variants(
  MODAL_POPUP_CLASS,
  {
    openAnimation: MODAL_OPEN_ANIMATION_CLASSES,
    closeAnimation: MODAL_CLOSE_ANIMATION_CLASSES,
  },
  {
    openAnimation: 'scale',
    closeAnimation: 'scale',
  },
)

export const modalButtonVariants = variants(
  `${ACTION_BASE} cursor-pointer disabled:cursor-not-allowed disabled:opacity-50`,
  {
    variant: {
      default:
        'border border-border bg-card text-card-foreground shadow-[0_1px_2px_color-mix(in_oklab,var(--foreground)_6%,transparent)] hover:bg-accent hover:text-accent-foreground',
      quiet:
        'border border-input bg-background text-foreground shadow-[0_1px_2px_color-mix(in_oklab,var(--foreground)_8%,transparent)] hover:enabled:bg-accent hover:enabled:text-accent-foreground',
      danger:
        'bg-destructive text-destructive-foreground hover:enabled:bg-[color-mix(in_oklab,var(--destructive)_88%,var(--foreground))]',
    },
    size: {
      sm: 'min-h-8 px-3 py-1.5 text-xs',
      md: 'min-h-9 px-3 py-2 text-sm',
      lg: 'min-h-10 px-4 py-2 text-sm',
    },
  },
  {
    variant: 'default',
    size: 'md',
  },
)

export type ModalButtonVariants = VariantProps<{
  variant: Record<'default' | 'quiet' | 'danger', string>
  size: Record<'sm' | 'md' | 'lg', string>
}>
