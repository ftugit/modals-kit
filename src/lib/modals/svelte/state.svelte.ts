// Хуки чтения состояния. Порт `state.ts` оригинала.
//
// Там они возвращали `Accessor` либо живой объект с реактивными геттерами
// (идиома Solid: чтение свойства трекается по факту обращения). В Svelte
// то же самое даёт объект с геттерами над реактивным зеркалом стора —
// снапшот не пересобирается, неактивные слои не замораживают значения.
import { hasLockedEntry, resolveEntry, runtimeKey } from '../core'
import { entryLabel } from '../types'
import type { Chain, HostConfig, ModalContext, ResolvedEntry, RuntimeState } from '../types'
import { useInstance, useModals } from './context'

/* ── ИСТОЧНИК СЧЁТЧИКОВ ─────────────────────────────────────────────
 *
 * 🔴 В стопке может лежать запись СИСТЕМНОГО ОВЕРЛЕЯ, у которой нет
 * собственного содержимого и DOM: `overrides.headless === true`.
 *
 * Её заводит хост, когда усыновляет чужой узел и делает его модальным —
 * сегодня это мобильный лист `select`. Запись настоящая: она держит место
 * в истории («Назад» закрывает лист), очередь закрытия (Escape снимает
 * верхнее) и саму модальность — фон, блокировку прокрутки, aria-изоляцию
 * (решения D25/D26). Поэтому счётчики ниже её УЧИТЫВАЮТ намеренно:
 * «открыт модальный слой» в этот момент — правда, и `closeAll()` обязан
 * его закрыть.
 *
 * Практически это значит: пока открыт мобильный список, `useModalDepth()`
 * вернёт на единицу больше, чем видно «настоящих» модалок, а
 * `useModalsOpen()` — `true`, даже если ни одной обычной модалки нет.
 *
 * Если счётчик нужен ТОЛЬКО для настоящих модалок, не вычитайте единицу
 * вслепую (оверлеев может не быть вовсе), а отфильтруйте:
 *
 *     import { visibleChain } from '$lib/modals'
 *     const real = visibleChain(useChain().current).length
 *
 * Проверено измерением: попытка исключить такие записи из счётчиков
 * ломает интерфейс — кнопка «Закрыть все» показывала (0) и гасла, пока
 * экран накрыт листом с заблокированной прокруткой (журнал, D27).
 * ------------------------------------------------------------------ */

/** Вся цепочка: кто открыт, кто по счёту. Включая системные оверлеи. */
export function useChain(): { readonly current: Chain } {
  const m = useModals()
  return {
    get current() {
      return m.view.chain
    },
  }
}

/** Глубина стопки. Системный оверлей (headless) тоже считается — см. выше. */
export function useModalDepth(): { readonly value: number } {
  const m = useModals()
  return {
    get value() {
      return m.view.chain.length
    },
  }
}

/** Открыт ли хоть один модальный слой, включая системный оверлей. */
export function useModalsOpen(): { readonly value: boolean } {
  const m = useModals()
  return {
    get value() {
      return m.view.chain.length > 0
    },
  }
}

/** В стопке есть заблокированная модалка — обычное «закрыть всё» недоступно. */
export function useChainLocked(): { readonly value: boolean } {
  const m = useModals()
  return {
    get value() {
      return hasLockedEntry(m.view.chain, m.scope.lookup)
    },
  }
}

/** Текущая конфигурация хоста как живое read-only значение. */
export function useHostConfig(): { readonly value: HostConfig } {
  const m = useModals()
  return {
    get value() {
      return m.view.hostConfig
    },
  }
}

/* ── данные этой модалки ───────────────────────────────────────────── */

export type ModalHandle<P extends Record<string, unknown> = Record<string, unknown>> =
  ModalContext<P> & { readonly active: boolean; readonly resolved: ResolvedEntry }

/**
 * Данные этой модалки и её место в стопке.
 * Живой объект: глубина, цепочка и данные читаются на каждый доступ.
 */
export function useModal<
  P extends Record<string, unknown> = Record<string, unknown>,
>(): ModalHandle<P> {
  const instance = useInstance()
  if (!instance) {
    throw new Error('[modals] useModal вызван вне содержимого модалки')
  }
  const m = useModals()

  const resolved = (): ResolvedEntry => {
    const entry = m.view.chain[instance.index] ?? {
      kind: 'registered' as const,
      name: instance.name,
      params: {},
      overrides: {},
    }
    return resolveEntry(entry, instance.index, m.scope.lookup)
  }

  return {
    name: instance.name,
    index: instance.index,
    get depth() {
      return m.view.chain.length
    },
    get params() {
      return resolved().params as P
    },
    get chain() {
      return m.view.chain
    },
    get data() {
      return m.view.sharedData
    },
    get active() {
      return instance.index === m.view.chain.length - 1
    },
    get resolved() {
      return resolved()
    },
  }
}

/* ── состояние другой модалки ──────────────────────────────────────── */

export interface ModalStateHandle {
  readonly entry: ResolvedEntry | null
  readonly runtime: RuntimeState
}

/**
 * Состояние другой модалки — по индексу или по имени.
 *
 * ⚠️ Отличие от оригинала: там поиск шёл по `e.name`, но у `transient`-записи
 * имени нет. Сравниваем через `entryLabel` — для `registered` это имя,
 * для `transient` его id.
 */
export function useModalState(target: number | string): ModalStateHandle {
  const m = useModals()

  const found = () => {
    const chain = m.view.chain
    const index =
      typeof target === 'number' ? target : chain.findIndex((e) => entryLabel(e) === target)
    const entry = index >= 0 ? chain[index] : undefined
    return {
      entry,
      index,
      key: entry ? runtimeKey(entryLabel(entry), index) : 'none:none',
    }
  }

  return {
    get entry() {
      const f = found()
      return f.entry ? resolveEntry(f.entry, f.index, m.scope.lookup) : null
    },
    get runtime() {
      return m.view.runtime[found().key] ?? { status: 'idle' as const }
    },
  }
}

/* ── обмен данными между модалками ─────────────────────────────────── */

/**
 * Свои данные, видны остальным модалкам.
 * Возвращает объект со свойством `value`: чтение реактивно, запись
 * кладёт значение и в свою ячейку, и на общую доску.
 */
export function useModalData<T = unknown>(): { value: T | undefined } {
  const instance = useInstance()
  const m = useModals()
  const key = instance ? runtimeKey(instance.name, instance.index) : 'detached'

  return {
    get value() {
      return m.view.data[key] as T | undefined
    },
    set value(next: T | undefined) {
      m.modals.store.merge('data', { [key]: next })
      m.modals.store.merge('sharedData', { [key]: next })
    },
  }
}

/** Общая доска всех модалок. */
export function useSharedData(): { readonly value: Record<string, unknown> } {
  const m = useModals()
  return {
    get value() {
      return m.view.sharedData
    },
  }
}

/** Состояние загрузки этой модалки. */
export function useLoader<T = unknown>(): {
  readonly status: RuntimeState['status']
  readonly data: T | undefined
  readonly error: string | undefined
  readonly loading: boolean
  readonly ready: boolean
} {
  const instance = useInstance()
  const m = useModals()
  const key = instance ? runtimeKey(instance.name, instance.index) : 'detached:none'
  const rt = () => (m.view.runtime[key] ?? { status: 'idle' as const }) as RuntimeState<T>

  return {
    get status() {
      return rt().status
    },
    get data() {
      return rt().data
    },
    get error() {
      return rt().error
    },
    get loading() {
      return rt().status === 'loading'
    },
    get ready() {
      return rt().status === 'ready'
    },
  }
}
