/* @unocss-include */
import { variants, type VariantProps } from '../cn'
import {
  MODAL_BACKDROP_CLASS,
  MODAL_CLOSE_ANIMATION_CLASSES,
  MODAL_OPEN_ANIMATION_CLASSES,
  MODAL_POPUP_CLASS,
} from '$lib/modals/svelte/classes'

/**
 * CVA-наборы модальных примитивов.
 *
 * Всё оформление — атомарные утилиты UnoCSS/presetWind4; CSS-файла у
 * модальной системы нет вовсе. Маркер-классов тоже: снаружи система видна
 * по data-атрибутам (`data-modal-trigger`, `data-modal-btn`,
 * `data-modal-popup`…), их ставят компоненты.
 *
 * Общие части оболочки/фона берутся из `$lib/modals/svelte/classes` —
 * там их видит и сам хост (`ModalHost`), поэтому источник правды один.
 *
 * `@unocss-include` нужен по той же причине, что и в `classes.ts`: UnoCSS
 * по умолчанию сканирует разметку, а не .ts-модули, и без пометки все
 * классы ниже остались бы строками в JS — без единого правила в CSS.
 */

/* Общая геометрия кнопок и триггеров: 36px минимум, паддинги 8/12,
   размер шрифта, переход по background/color/opacity и фокусное кольцо. */
const ACTION_BASE =
  'inline-flex min-h-9 items-center justify-center gap-1.5 rounded-[calc(var(--radius)-2px)] px-3 py-2 text-[14px] font-medium leading-none no-underline [transition:background_150ms_ease,color_150ms_ease,opacity_150ms_ease] focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2'

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
    /**
     * Размер меняет только высоту и отступы: кегль и line-height заданы базой
     * (14px / 1), иначе `text-sm` вернул бы line-height 20px — в исходнике
     * у `.modal-btn` стояло `line-height: 1`.
     */
    size: {
      sm: 'min-h-8 px-3 py-1.5 text-xs leading-none',
      md: 'min-h-9 px-3 py-2 text-[14px] leading-none',
      lg: 'min-h-10 px-4 py-2 text-[14px] leading-none',
    },
  },
  {
    variant: 'default',
    size: 'md',
  },
)

/**
 * Триггер модалки: та же геометрия, но с карточным фоном и состояниями
 * загрузки/ошибки/открытия (data-state ставит ModalTrigger/LoadLink).
 *
 * У состояния ошибки есть и ховер-двойник: без него ховер (одинаковая
 * специфичность, но позже в таблице утилит) перекрашивал бы кнопку в accent.
 */
export const modalTriggerVariants = variants(
  `${ACTION_BASE} border border-border bg-card text-card-foreground shadow-[0_1px_2px_color-mix(in_oklab,var(--foreground)_6%,transparent)] hover:bg-accent hover:text-accent-foreground data-[state=loading]:cursor-not-allowed data-[state=error]:cursor-not-allowed data-[state=open]:cursor-not-allowed data-[state=loading]:opacity-65 data-[state=error]:opacity-65 data-[state=open]:opacity-85 data-[state=error]:bg-destructive data-[state=error]:text-destructive-foreground data-[state=error]:hover:bg-destructive data-[state=error]:hover:text-destructive-foreground`,
  {},
  {},
)

export type ModalButtonVariants = VariantProps<{
  variant: Record<'default' | 'quiet' | 'danger', string>
  size: Record<'sm' | 'md' | 'lg', string>
}>
