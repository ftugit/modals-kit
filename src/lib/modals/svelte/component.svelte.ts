// Ленивый вид модалки: компонент можно зарегистрировать не готовым
// компонентом, а загрузчиком `lazy(() => import('./X.svelte'))`. Тогда
// готовность записи — это данные И доехавший чанк: загрузчик (`loader.ts`)
// ждёт `ensureModalComponent` тем же ожиданием, что данные, поэтому между
// скелетоном и содержимым нет пустого кадра, а кнопка открытия греет чанк
// предзагрузкой. Раньше это делали файлы-обёртки `{#await import(...)}`
// по одной на модалку — с тем же импортом, но без pending-состояния:
// обёртка монтировалась уже после `ready` и до прихода чанка не рендерила
// ничего. Теперь обёрток нет: путь импорта пишется один раз, в регистрации.
//
// Ядро вида не знает (`component: V` непрозрачен); всё здесь — слой Svelte.

/** Загрузчик вида: динамический импорт модуля с компонентом по умолчанию. */
export type ModalComponentLoader = () => Promise<{ default: unknown }>

const LAZY = Symbol('modal-lazy-component')

interface LazyComponent {
  readonly [LAZY]: ModalComponentLoader
}

/**
 * Пометить вид модалки ленивым: `component: lazy(() => import('./X.svelte'))`.
 * Возвращаемое значение непрозрачно — его понимает только этот слой.
 */
export function lazy(load: ModalComponentLoader): unknown {
  return Object.freeze({ [LAZY]: load })
}

function isLazy(component: unknown): component is LazyComponent {
  return (
    !!component &&
    typeof component === 'object' &&
    typeof (component as LazyComponent)[LAZY] === 'function'
  )
}

/**
 * Идущие импорты по объекту регистрации: один импорт на модалку.
 * `settled` — импорт уже доехал: вид на месте, ждать снова нечего.
 */
interface PendingView {
  promise: Promise<void>
  settled: boolean
}
const inflight = new WeakMap<object, PendingView>()

/** Доехавшие компоненты по имени модалки (реактивно: читает `ModalContent`). */
let resolvedByName = $state<Record<string, unknown>>({})

/**
 * Дождаться вида записи. `undefined` — ждать нечего: вид не ленивый или уже
 * доехал, поэтому вызывающий не показывает скелетон на ровном месте.
 * Сбой импорта не кешируется: следующее открытие попробует ещё раз.
 */
export function ensureModalComponent(definition: {
  name: string
  component?: unknown
}): Promise<void> | undefined {
  const component = definition?.component
  if (!isLazy(component)) return undefined
  if (resolvedByName[definition.name] !== undefined) return undefined
  const known = inflight.get(component)
  if (known) return known.settled ? undefined : known.promise

  const pending: PendingView = { settled: false, promise: Promise.resolve() }
  pending.promise = component[LAZY]().then((module) => {
    pending.settled = true
    resolvedByName = { ...resolvedByName, [definition.name]: module.default }
  })
  inflight.set(component, pending)
  void pending.promise.catch(() => {
    if (inflight.get(component) === pending) inflight.delete(component)
  })
  return pending.promise
}

/**
 * Вид записи для рендера: готовый компонент — он сам, ленивый — доехавший
 * из кеша (к моменту `ready` загрузчик его уже дождался), ещё не доехал —
 * `undefined` (рендерить нечего, как раньше у обёрток `{#await}`).
 */
export function resolvedModalComponent(definition: {
  name: string
  component?: unknown
}): unknown {
  const component = definition?.component
  if (!component) return undefined
  if (!isLazy(component)) return component
  return resolvedByName[definition.name]
}
