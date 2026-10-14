// Общая часть `asLink` и `asModalLink`: состояние задачи → атрибуты элемента.
//
// Разметки здесь нет. Состояние видно атрибутами, а рисует его ОДНО правило
// CSS (`indicator.ts`) — одинаково на голой `<a>` и на `Button`:
//
//   data-state="loading" — спиннер перед текстом (через 150 мс, см. ниже)
//   data-state="error"   — знак «!», причина в `title`
//   data-task-percent    — процент рядом со спиннером, если ход известен
//   aria-busy="true"     — пока показан спиннер
import type { Attachment } from 'svelte/attachments'
import { taskPercent, type TaskState } from '#lib/task/index.js'

/**
 * Задержка показа спиннера: переход, который уложился в неё, не мигает.
 * «Мелкие» записи адреса (модалки, пагинатор) держат `navigating` 1–2 мс
 * (замер хода 129) и сюда не доходят вовсе.
 */
export const LINK_TASK_DELAY_MS = 150

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

interface ReflectOptions {
  /** Состояние без задачи, но со своим видом (`open` у ссылки на модалку). */
  idleState?: () => string | undefined
  /** Занят ли элемент (повторный клик гасится) — `aria-disabled`. */
  busy?: () => boolean
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

  // Таймер зависит только от «идёт / не идёт»: ход задачи его не перезапускает.
  let shown = $state(false)
  $effect(() => {
    if (!pending) {
      shown = false
      return
    }
    const timer = setTimeout(() => (shown = true), LINK_TASK_DELAY_MS)
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

  overlay(el, 'aria-busy', () => (shown ? 'true' : null))
  overlay(el, 'title', () => (task.status === 'error' ? task.message : null))
  if (options.busy) overlay(el, 'aria-disabled', () => (options.busy!() ? 'true' : null))
}

/** Свой атрибут поверх чужого: пока `value()` не `null` — свой, потом — прежний. */
function overlay(el: HTMLElement, name: string, value: () => string | null): void {
  $effect(() => {
    const next = value()
    if (next === null) return
    const before = el.getAttribute(name)
    el.setAttribute(name, next)
    return () => {
      if (before === null) el.removeAttribute(name)
      else el.setAttribute(name, before)
    }
  })
}
