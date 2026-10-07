/* @unocss-include */
/**
 * Атомарные классы модальной системы (UnoCSS / presetWind4).
 *
 * Здесь только утилиты: каждое правило прежнего modals.css выражено
 * классами, а CSS-файла у системы больше нет — `modals.css` удалён.
 *
 * Откуда берутся анимации (своих `@keyframes` нет ни одного):
 *
 *   • бесконечные — кадры `pulse`, `spin` и `flash` из presetWind4. Кадры
 *     приезжают ТОЛЬКО с именованной утилитой (`animate-pulse`, `animate-spin`,
 *     `animate-flash`): у произвольной формы `animate-[…]` Uno печатает
 *     `animation`, но сами `@keyframes` не выводит. Поэтому рядом стоит
 *     именованная утилита — она приносит кадры, а свою длительность и режим
 *     задаёт произвольная форма, помеченная `!` (иначе порядок правил решал бы
 *     исход: `.animate-pulse` печатается после произвольного значения и его
 *     shorthand `animation` затирал бы настройку);
 *   • появление — не кадры, а переход из `@starting-style` (вариант
 *     `starting:`): содержимое после скелетона и панель списка монтируются
 *     скрытыми и тут же проявляются. Так же устроены и открытие/закрытие
 *     оболочки, только там первый кадр ставит Ark через
 *     `data-starting-style` / `data-ending-style`.
 *
 * Промах на старте: бесконечные утилиты требуют пометки `@unocss-include`
 * (см. ниже) — этот файл .ts, и по умолчанию UnoCSS его не сканирует.
 *
 * Разметочных marker-классов (`modal-popup`, `modal-layer`, `modal-stage`…)
 * здесь тоже нет: тесты и внешние стили цепляются за data-атрибуты
 * (`data-modal-popup`, `data-modal-layer`…) — их ставят компоненты системы.
 */
import type { CloseAnimation, OpenAnimation } from '../types'

/* ── хост ─────────────────────────────────────────────────────────── */

/**
 * Утилиты фона — общий набор для ВСЕХ подложек приложения: фона стопки и
 * мобильной подложки drawer'а сайдбара (`AppShell` импортирует эту
 * константу). Так «фон модалки» и «фон сайдбара» не разъезжаются: fixed на
 * весь экран (значит, и поверх шапки), затемнение 60%, blur(2px), переход
 * opacity 220 ms, гашение в reduced-motion.
 */
export const BACKDROP_UTILS =
  'fixed inset-0 z-200 bg-black/60 backdrop-blur-[2px] transition-opacity duration-220 ease-[ease] motion-reduce:duration-[1ms]'

/**
 * Фон стопки и фон листа. Один и тот же набор классов у обеих поверхностей.
 * `data-starting-style` / `data-ending-style` ставит фазовый эффект хоста.
 */
export const MODAL_BACKDROP_CLASS = `${BACKDROP_UTILS} data-[starting-style]:opacity-0 data-[ending-style]:opacity-0`

/** Кнопка закрытия поверх фона. */
export const MODAL_CLOSE_CLASS =
  'fixed top-4 right-4 z-220 flex size-9 items-center justify-center rounded-[calc(var(--radius)-2px)] border border-border bg-popover text-popover-foreground shadow-[0_10px_25px_-12px_color-mix(in_oklab,var(--foreground)_45%,transparent)] transition-[background-color,color] duration-150 ease-[ease] hover:bg-accent hover:text-accent-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2'

/** Слой поверх фона: раскладку (align/justify/padding) дописывает viewportStyle(). */
export const MODAL_VIEWPORT_CLASS = 'fixed inset-0 z-210 flex p-0'

/**
 * Сцена — `group/stage` для детей: хвост и оболочка берут от неё
 * transform-origin по `data-anchor`. Раньше это были потомковые правила
 * `.modal-stage[data-anchor='…'] .modal-tail`.
 */
export const MODAL_STAGE_CLASS =
  'group/stage relative flex items-center justify-center max-w-full max-h-full data-[anchor=top]:w-full data-[anchor=bottom]:w-full data-[anchor=left]:h-full data-[anchor=right]:h-full data-[fullpage]:w-full data-[fullpage]:h-full'

/** Один слой стопки (неактивные дополнительно скрываются инлайн-стилем). */
export const MODAL_LAYER_CLASS = 'flex min-h-0 flex-auto flex-col h-full'

/** Содержимое одной записи. */
export const MODAL_CONTENT_CLASS = 'flex min-h-0 flex-auto flex-col h-full'

/**
 * Проявление содержимого после скелетона.
 *
 * Было `animation: modal-reveal 260ms …` со своими кадрами. Стало переходом:
 * первый кадр задаёт `starting:` (он же `@starting-style`), конечный —
 * обычное состояние без классов. Единственная разница на глаз: анимация
 * с `both` держала конечный кадр, переход оставляет элемент в обычном
 * состоянии — визуально то же самое, но исчезла точка отказа «кадры не
 * доехали» и вместе с ней сам файл кадров.
 */
export const MODAL_REVEAL_CLASS =
  'transition-[opacity,transform] duration-260 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:duration-[1ms] starting:opacity-0 starting:translate-y-1.5 starting:scale-[0.99]'

/* ── оболочка и хвост ─────────────────────────────────────────────── */

/**
 * Оболочка активной записи.
 *
 * `data-stack-role="tail"` — та же оболочка под листом: уезжает в стопку.
 * Направление приходит от сцены (`group-data-[anchor=…]/stage`), как у
 * прежних правил `.modal-stage[data-anchor='top'] .modal-popup[data-stack-role='tail']`.
 */
export const MODAL_POPUP_CLASS =
  'relative z-1 flex flex-col overflow-hidden border border-border bg-card text-card-foreground shadow-[0_24px_50px_-16px_color-mix(in_oklab,var(--foreground)_32%,transparent),0_8px_18px_-10px_color-mix(in_oklab,var(--foreground)_22%,transparent)] [transition:width_280ms_cubic-bezier(0.32,0.72,0,1),height_280ms_cubic-bezier(0.32,0.72,0,1),background_240ms_ease,border-radius_240ms_ease,transform_280ms_cubic-bezier(0.32,0.72,0,1),opacity_240ms_ease] motion-reduce:duration-[1ms] focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 data-[stack-role=tail]:origin-top data-[stack-role=tail]:opacity-[0.85] data-[stack-role=tail]:pointer-events-none data-[stack-role=tail]:[transform:scale(0.94)_translateY(-7px)] group-data-[anchor=top]/stage:data-[stack-role=tail]:origin-bottom group-data-[anchor=top]/stage:data-[stack-role=tail]:[transform:scale(0.94)_translateY(7px)] group-data-[anchor=left]/stage:data-[stack-role=tail]:origin-right group-data-[anchor=left]/stage:data-[stack-role=tail]:[transform:scale(0.94)_translateX(7px)] group-data-[anchor=right]/stage:data-[stack-role=tail]:origin-left group-data-[anchor=right]/stage:data-[stack-role=tail]:[transform:scale(0.94)_translateX(-7px)]'

/** Пустая обманка под активной оболочкой (габариты и сдвиг — tailStyle). */
export const MODAL_TAIL_CLASS =
  'border border-border bg-card shadow-[0_18px_40px_-24px_color-mix(in_oklab,var(--foreground)_50%,transparent),0_4px_12px_-4px_color-mix(in_oklab,var(--foreground)_30%,transparent)] origin-bottom [transition:transform_320ms_cubic-bezier(0.32,0.72,0,1),opacity_260ms_ease,background_200ms_ease] motion-reduce:duration-[1ms] group-data-[anchor=bottom]/stage:origin-top group-data-[anchor=left]/stage:origin-right group-data-[anchor=right]/stage:origin-left'

/**
 * Контейнер host-owned оверлея (select, меню, лист).
 *
 * `group/sheet` — маркер группы для содержимого: список берёт от контейнера
 * направление (`group-data-[mobile-anchor=…]/sheet`), чтобы закруглить
 * прижатый край, как это делало правило `[data-layout='sheet'][data-mobile-anchor=…]`.
 * Раскладку листа задают классы по `data-anchor` (см. `floatingLayoutClass`).
 */
export const MODAL_FLOATING_CLASS = 'group/sheet pointer-events-auto'

/**
 * Раскладка контейнера-листа: полный экран либо прижатие к краю.
 *
 * Бюджет высоты объявляется здесь же, рядом с `max-h`/`h-dvh`, и уезжает
 * переменной `--host-floating-max-height`: содержимое листа (список select)
 * обязано укладываться в тот же предел. Иначе длинный список растягивает
 * контейнер с `h-auto` до своей высоты (2000+ px), тот обрезается `max-h`,
 * а внутренний скролл не появляется: список становится «не длиннее себя»
 * и прокручивать нечего.
 */
export function floatingLayoutClass(anchor: string | undefined): string {
  if (anchor === 'bottom')
    return 'fixed inset-x-0 bottom-0 top-auto w-screen h-auto max-h-[85dvh] [--host-floating-max-height:85dvh]'
  if (anchor === 'top')
    return 'fixed inset-x-0 top-0 bottom-auto w-screen h-auto max-h-[85dvh] [--host-floating-max-height:85dvh]'
  if (anchor === 'left')
    return 'fixed inset-y-0 left-0 right-auto w-[min(90vw,24rem)] h-dvh [--host-floating-max-height:100dvh]'
  if (anchor === 'right')
    return 'fixed inset-y-0 right-0 left-auto w-[min(90vw,24rem)] h-dvh [--host-floating-max-height:100dvh]'
  return 'fixed inset-0 w-screen h-dvh max-h-none [--host-floating-max-height:100dvh]'
}

/* ── состояния: скелетон, ошибка, спиннер ─────────────────────────── */

export const MODAL_SKELETON_CLASS = 'flex flex-col gap-3 p-5'
export const MODAL_SKELETON_LINE_CLASS =
  'h-3 rounded-[calc(var(--radius)-4px)] bg-muted animate-pulse animate-[pulse_1.4s_ease-in-out_infinite]!'
export const MODAL_SKELETON_TITLE_CLASS = 'h-5 w-[55%]'
export const MODAL_SKELETON_GRID_CLASS =
  'grid grid-cols-[repeat(2,minmax(0,1fr))] gap-2.5 pt-1'
export const MODAL_SKELETON_CARD_CLASS =
  'h-16 rounded-[var(--radius)] bg-muted animate-pulse animate-[pulse_1.4s_ease-in-out_infinite]!'
export const MODAL_ERROR_CLASS =
  'flex flex-1 flex-col items-center justify-center gap-2.5 p-7 text-center text-destructive'
export const MODAL_ERROR_TITLE_CLASS = 'text-sm font-semibold'
export const MODAL_ERROR_HINT_CLASS =
  'text-xs text-[color-mix(in_oklab,var(--destructive)_78%,var(--muted-foreground))]'
export const MODAL_SPINNER_CLASS =
  'size-3.5 rounded-full border-2 border-current border-t-transparent animate-spin animate-[spin_0.7s_linear_infinite]!'

/* ── анимации открытия/закрытия ───────────────────────────────────── */

/**
 * Шаг входа/выхода оболочки. Ключи — значения `HostConfig.openAnimation` и
 * `closeAnimation`; `none` гасит переход целиком (`transition: none` — иначе
 * `exitWaitMs` ждал бы базовые 280 ms, как раньше с `.modal-*-none`).
 */
export const MODAL_OPEN_ANIMATION_CLASSES: Record<OpenAnimation, string> = {
  scale: 'data-[starting-style]:opacity-0 data-[starting-style]:[transform:scale(0.94)]',
  'slide-up': 'data-[starting-style]:opacity-0 data-[starting-style]:[transform:translateY(28px)]',
  fade: 'data-[starting-style]:opacity-0',
  none: 'data-[starting-style]:transition-none',
}

export const MODAL_CLOSE_ANIMATION_CLASSES: Record<CloseAnimation, string> = {
  scale: 'data-[ending-style]:opacity-0 data-[ending-style]:[transform:scale(0.94)]',
  'slide-down': 'data-[ending-style]:opacity-0 data-[ending-style]:[transform:translateY(28px)]',
  fade: 'data-[ending-style]:opacity-0',
  none: 'data-[ending-style]:transition-none',
}
