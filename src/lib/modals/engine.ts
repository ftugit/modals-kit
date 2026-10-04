// Движок — среда, в которой живёт стопка: адрес, история, предзагрузка.
// Всё, что зависит от фреймворка, входит сюда и больше никуда.
//
// Модель: модалка(движок(хранилище), опции).
//   движок    — ОТКУДА берутся адрес/история/навигация  (SvelteKit, React, …)
//   хранилище — ГДЕ лежит сама цепочка                  (адрес, localStorage, память)
//
// Почему именно вложение, а не два независимых параметра: хранилище
// «в адресе» без движка бессмысленно, а движок без хранилища ничего
// не хранит. Зато вложение делает выразимым то, что раньше не выражалось:
// цепочка в localStorage, а Назад/Вперёд — от движка.
import type { PreloadResult } from './core-contract'

export interface ChainEngine {
  readonly name: string

  /** Настоящий текущий адрес. */
  location(): { pathname: string; search: string }

  /**
   * Добавить запись истории. `url` может совпадать с текущим — тогда
   * адрес не меняется, но шаг истории появляется (так работает localStorage
   * с живыми Назад/Вперёд).
   */
  pushState(url: string, state: Record<string, unknown>): void
  replaceState(url: string, state: Record<string, unknown>): void

  /** Состояние текущей записи истории. */
  state(): Record<string, unknown>

  /** Внешняя навигация. Нет — внешних изменений не бывает (SSR). */
  onPopState?(fn: () => void): () => void

  /** Шаг по истории. Нет — истории нет, закрытие пойдёт через replace. */
  go?(delta: number): void

  /** Данные маршрута силами фреймворка. */
  preload?(href: string): Promise<PreloadResult>

  /** Существует ли маршрут (там, где это выясняется в рантайме). */
  resolves?(href: string): boolean
}

/**
 * Движок без окружения: SSR, тесты, встраивание.
 * Истории нет и навигации нет — контракт это переживает.
 */
export function memoryEngine(initialUrl = '/'): ChainEngine {
  let url = initialUrl
  let state: Record<string, unknown> = {}
  return {
    name: 'memory',
    location() {
      const u = new URL(url, 'http://local')
      return { pathname: u.pathname, search: u.search }
    },
    pushState(next, s) {
      url = next
      state = s
    },
    replaceState(next, s) {
      url = next
      state = s
    },
    state: () => state,
    // go / onPopState / preload / resolves — намеренно отсутствуют
  }
}
