/**
 * Хранилища пагинаторов, изолированные по ключу носителя.
 *
 * Зачем: одно имя пагинатора (`user-blocks`, `seed-users`) обслуживает разные
 * экраны — глобальный список, персональный список, пикер. Пока все они делят
 * одну ячейку общего Store, вторая монтировка перетирает первую: её снапшот
 * приходит новым объектом, `hydrate` заменяет ячейку, загруженные порции и
 * позиция скролла теряются.
 *
 * Ключ выбирает владелец (модалка-носитель) и передаёт вложенным экранам —
 * тот же ключ читает фильтр-экран, не создавая второй области. Живёт область
 * ровно столько, сколько жива запись стопки: пока носитель смонтирован,
 * `refs > 0`. Освобождение последней ссылки удаляет ячейки целиком — вместе с
 * внутренним `extra.ids` пикера, отдельная уборка не нужна.
 */
import { createPaginatorStore, type Store } from './store'

interface ScopeEntry {
  store: Store
  refs: number
}

const scopes = new Map<string, ScopeEntry>()

/**
 * Хранилище области `key`: существующее или новое.
 * Каждый вызов увеличивает счётчик ссылок — освобождать нужно столько же раз.
 */
export function acquireScopedStore(key: string): Store {
  const found = scopes.get(key)
  if (found) {
    found.refs += 1
    return found.store
  }
  const store = createPaginatorStore()
  scopes.set(key, { store, refs: 1 })
  return store
}

/** Освободить область `key`; последняя ссылка удаляет её состояние. */
export function releaseScopedStore(key: string): void {
  const found = scopes.get(key)
  if (!found) return
  found.refs -= 1
  if (found.refs <= 0) scopes.delete(key)
}

/** Хранилище области `key`, если владелец ещё жив. Годится для чтения без захвата. */
export function findScopedStore(key: string | null | undefined): Store | undefined {
  return key ? scopes.get(key)?.store : undefined
}
