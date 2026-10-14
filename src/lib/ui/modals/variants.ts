/* @unocss-include */
import { variants } from '../cn'
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
