// Общая часть `asLink` и `asModalLink`: состояние задачи → атрибуты элемента.
//
// Разметки здесь нет. Состояние видно атрибутами, а рисует его ОДНО правило
// CSS (`indicator.ts`) — одинаково на голой `<a>` и на `Button`:
//
//   data-state="loading" — спиннер перед текстом (через 150 мс, см. ниже)
//   data-state="error"   — знак «!», причина в `title`
//   data-task-percent    — процент рядом со спиннером, если ход известен
//   aria-busy="true"     — пока показан спиннер
//
// Каждая такая задача попадает и в глобальный лоадер (`components/loader`).
import { createAttachmentKey, type Attachment } from 'svelte/attachments'
import { taskPercent, type TaskState } from '#lib/task/index.js'
import { TASK_DELAY_MS, trackTask } from '../loader.svelte.js'

/**
 * Атрибуты, которые `asLink`/`asModalLink` кладут на элемент. Только то, что
 * известно уже на сервере (без JS ссылка работает или честно заблокирована);
 * живое состояние после гидрации пишет вложение (`[symbol]`).
 */
export interface LinkAttrs {
  href?: string | null
  role?: 'link'
  title?: string
  'aria-disabled'?: 'true'
  'aria-haspopup'?: 'dialog'
  'data-state'?: 'error'
  'data-link'?: ''
  'data-modal-link'?: ''
  'data-pending'?: ''
  'data-sveltekit-replacestate'?: ''
  [attachment: symbol]: Attachment<HTMLElement>
}

/** Модификаторы и средняя кнопка — отдаём браузеру, как обычной ссылке. */
export const isModified = (e: MouseEvent): boolean => e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0

/** Клик по заблокированной ссылке ничего не делает (с JS; без JS у неё нет `href`). */
export function blockClicks(el: HTMLElement): () => void {
  const block = (e: MouseEvent) => e.preventDefault()
  el.addEventListener('click', block)
  return () => el.removeEventListener('click', block)
}

/** Собрать атрибуты без `undefined`: иначе пустой ключ перетёр бы атрибут, стоящий до spread. */
export function defined(attrs: Record<string, unknown>): Record<string, unknown> {
  for (const key of Object.keys(attrs)) if (attrs[key] === undefined) delete attrs[key]
  return attrs
}

/**
 * Режим отображения локального индикатора (спиннера и процента) на самом элементе:
 *   - `true` (по умолчанию) — показывать всегда, пока задача элемента `pending`;
 *   - `'click'` — показывать только если нажатие произошло на этом самом элементе
 *     (фоновые подгрузки при скролле или переход из другого места спиннер не зажигают);
 *   - `false` — полностью отключить локальный индикатор загрузки на элементе.
 */
export type LinkIndicatorMode = boolean | 'click'

interface ReflectOptions {
  /** Состояние без задачи, но со своим видом (`open` у ссылки на модалку). */
  idleState?: () => string | undefined
  /** Занят ли элемент (повторный клик гасится) — `aria-disabled`. */
  busy?: () => boolean
  /** Режим локального спиннера на элементе (`true` | `'click'` | `false`). */
  indicator?: LinkIndicatorMode | (() => LinkIndicatorMode)
}

/**
 * Пишет состояние задачи в атрибуты элемента. Вызывается внутри вложения:
 * эффекты живут, пока жив элемент. Чужие значения (`title`, `aria-busy`,
 * `aria-disabled` потребителя) не теряются: свои ставятся поверх и снимаются,
 * когда состояние уходит.
 */
export function reflectTask(el: HTMLElement, read: () => TaskState, options: ReflectOptions = {}): void {
  const task = $derived(read())
  const pending = $derived(task.status === 'pending')
  const mode = $derived<LinkIndicatorMode>(
    typeof options.indicator === 'function' ? options.indicator() : (options.indicator ?? true),
  )

  let clicked = $state(false)
  $effect(() => {
    if (mode !== 'click') {
      clicked = false
      return
    }
    const onPointerClick = () => {
      clicked = true
    }
    el.addEventListener('click', onPointerClick, true)
    return () => el.removeEventListener('click', onPointerClick, true)
  })

  // Таймер зависит от «идёт / не идёт» и разрешён ли показ на этом элементе.
  let shown = $state(false)
  $effect(() => {
    if (!pending) {
      shown = false
      clicked = false
      return
    }
    const allowed = mode === true || (mode === 'click' && clicked)
    if (!allowed) {
      shown = false
      return
    }
    const timer = setTimeout(() => (shown = true), TASK_DELAY_MS)
    return () => clearTimeout(timer)
  })

  $effect(() => {
    const state = task.status === 'error' ? 'error' : shown ? 'loading' : options.idleState?.()
    if (state) el.setAttribute('data-state', state)
    else el.removeAttribute('data-state')

    const percent = shown ? taskPercent(task) : null
    if (percent === null) el.removeAttribute('data-task-percent')
    else el.setAttribute('data-task-percent', String(percent))
  })

  // Та же задача — в общую полосу сверху (`components/loader`).
  $effect(() => trackTask(() => task))

  overlay(el, 'aria-busy', () => (shown ? 'true' : null))
  overlay(el, 'title', () => (task.status === 'error' ? task.message : null))
  if (options.busy) overlay(el, 'aria-disabled', () => (options.busy!() ? 'true' : null))
}

const TASK = createAttachmentKey()

/**
 * Состояние задачи на любой кнопке или ссылке без `asLink`: тот же вид, что у
 * ссылок (спиннер через 150 мс, процент, «!»), `aria-busy`, глобальный лоадер;
 * клик во время задачи гасится сразу (ни отправки формы, ни обработчиков).
 * Так задачу показывают `Button` (`task`) и сырые кнопки компонентов:
 *
 *     <button {...taskAttrs(() => paginatorTask(state()))} class="…">Сброс</button>
 */
export function taskAttrs(
  read: () => TaskState,
  options: { indicator?: LinkIndicatorMode | (() => LinkIndicatorMode) } = {},
): { 'data-task': ''; [attachment: symbol]: Attachment<HTMLElement> } {
  return { 'data-task': '', [TASK]: taskAttachment(read, options) }
}

/** Вложение из `taskAttrs` — для `{@attach}` там, где spread неудобен (`Button`). */
export function taskAttachment(
  read: () => TaskState,
  options: { indicator?: LinkIndicatorMode | (() => LinkIndicatorMode) } = {},
): Attachment<HTMLElement> {
  return (el) => {
    // Доступность не трогаем: `Button` сам ставит `disabled`, сырой элемент — его компонент.
    reflectTask(el, read, { indicator: options.indicator })
    const block = (e: Event) => {
      if (read().status !== 'pending') return
      e.preventDefault()
      e.stopImmediatePropagation()
    }
    el.addEventListener('click', block, true)
    return () => el.removeEventListener('click', block, true)
  }
}

/** Свой атрибут поверх чужого: пока `value()` не `null` — свой, потом — прежний. */
function overlay(el: HTMLElement, name: string, value: () => string | null): void {
  $effect(() => {
    const next = value()
    if (next === null) return
    const before = el.getAttribute(name)
    el.setAttribute(name, next)
    return () => {
      // Атрибут успел сменить его владелец (разметка Svelte, `form.intent()`
      // снимает свой `aria-busy`) — его значение свежее нашего «прежнего».
      if (el.getAttribute(name) !== next) return
      if (before === null) el.removeAttribute(name)
      else el.setAttribute(name, before)
    }
  })
}
