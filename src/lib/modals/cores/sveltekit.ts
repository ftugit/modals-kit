// Обвязка SvelteKit: ДВИЖОК, а не отдельный вид транспорта.
//
// Ядро SvelteKit.
//
//     модалка(ядро(хранилище), опции)
//     createModals(svelteKitCore(urlStorage()), { tailCount: 3 })
//
// Хранилище по умолчанию — адрес: у этой среды есть роутер и история,
// значит цепочку есть смысл делать ссылкой.
//
// Логики тут нет намеренно: появится условие — его место в url.ts.
import { browser } from '$app/environment'
import { preloadData, pushState, replaceState } from '$app/navigation'
import { page } from '$app/state'
import { buildCore, type CoreOptions, type ReconfigurableCore } from '../build'
import type { ChainEngine } from '../engine'
import { urlStorage } from '../storages'
import type { Sources } from '../build'
import type { ModalCore } from '../core-contract'
import { makeRouteResolves } from './routes'

/* ── таблица роутов: проверка адреса в РАНТАЙМЕ ────────────────────── */
/*
 * В оригинале таблицу роутов роутеру передавал корень приложения
 * (`FastEdgeApp({ routes })`), а `resolves(href)` (внешний адрес → true,
 * иначе `matchPath` по дереву) получали все: LoadLink блокировал битую
 * ссылку ДО клика, ModalTrigger через ЯДРО спрашивал, существует ли
 * страница `route`-модалки.
 *
 * Здесь таблицу играет glob по каталогу роутов SvelteKit — Vite сворачивает
 * его в список на сборке, это и есть «приложение передаёт фреймворку свои
 * роуты». Чистый матчер — в routes.ts; проверка живёт в СЛОЕ ФРЕЙМВОРКА
 * ЯДРА, а не в компонентах — решение владельца (осмотр 1.10-2, №30):
 * типизированный `resolve()` из `$app/paths` остаётся ДОПОЛНИТЕЛЬНЫМ
 * страховщиком на этапе компиляции, но рантайм-проверку он не заменяет —
 * битая ссылка обязана блокироваться и в чужом href, и в route-модалке.
 */

/** Существует ли адрес среди роутов ЭТОГО приложения. */
export const routeResolves = makeRouteResolves(
  Object.keys(import.meta.glob('/src/routes/**/+page.svelte')),
)

/**
 * Срез SvelteKit под `ChainEngine` — внутренняя деталь ядра.
 *
 * 🔴 Источник адреса зависит от среды, и это не мелочь:
 *   • в браузере — `window.location`, потому что `pushState()` НЕ обновляет
 *     `page.url` (спайк, SPIKE-HISTORY.md);
 *   • на сервере `window` нет вовсе, а `page.url` там как раз верен —
 *     «мелкой» навигации ещё не было.
 * Прежняя версия читала только `window.location` и падала при SSR.
 */
export function svelteKitEngine(): ChainEngine {
  return {
    name: 'sveltekit',
    location() {
      const u = browser ? window.location : page.url
      return { pathname: u.pathname, search: u.search }
    },

    // Только через $app/navigation: прямой history.pushState роутер SvelteKit
    // перетрёт и предупредит в консоли.
    pushState: (url, state) => pushState(url, state as App.PageState),
    replaceState: (url, state) => replaceState(url, state as App.PageState),

    /**
     * 🔴 Читаем `history.state`, а НЕ `page.state`.
     *
     * Проверено в браузере: при «мелкой» навигации, где адрес не меняется
     * (`pushState('')`), после Назад `history.state` уже верен, а
     * `page.state` остаётся от предыдущей записи. Из-за этого первый Назад
     * не снимал transient-слой, а второй снимал сразу два уровня.
     *
     * `sveltekit:states` — внутренний ключ роутера; зависимость от него
     * записана в журнал отклонений. Запасной путь — `page.state`:
     * он нужен на сервере, где `history` нет вовсе.
     */
    state: () => {
      // В браузере `history.state` — единственный источник, БЕЗ отката
      // на `page.state`. Отката тут быть не должно: после Назад ключа
      // `sveltekit:states` на записи может не быть вовсе, и тогда откат
      // возвращал устаревший `page.state` — слой, снятый кнопкой Назад,
      // продолжал считаться открытым. Поймано на transient-слое select.
      if (browser) {
        const raw = (window.history.state ?? {}) as Record<string, unknown>
        const states = raw['sveltekit:states']
        return (states && typeof states === 'object' ? states : {}) as Record<string, unknown>
      }
      // На сервере `history` нет вовсе — там только page.state.
      return page.state as Record<string, unknown>
    },

    /**
     * На сервере внешней навигации не бывает — метода просто нет,
     * и ядро узнает об этом через контракт, а не через исключение.
     *
     * 🔴 Уведомление ОТЛОЖЕНО на микрозадачу. Нативный `popstate` приходит
     * раньше, чем роутер SvelteKit успевает обновить `page.state`, поэтому
     * синхронное чтение даёт состояние ПРЕДЫДУЩЕЙ записи: первый «Назад»
     * не снимал transient-слой, второй снимал сразу два уровня.
     * В оригинале ровно от этого стоял `queueMicrotask(() => notify())`.
     */
    onPopState: browser
      ? (fn) => {
          const deferred = () => queueMicrotask(fn)
          window.addEventListener('popstate', deferred)
          return () => window.removeEventListener('popstate', deferred)
        }
      : undefined,

    // Нет `go` → нет истории → адаптер не отдаст `back`, и закрытие
    // пойдёт через replace. Ровно то, что нужно при SSR.
    go: browser ? (delta) => window.history.go(delta) : undefined,

    /**
     * Исполняет load() самой страницы маршрута. Канонический приём shallow
     * routing из документации SvelteKit — и он же снимает дублирование
     * «страница грузит своё, модалка грузит то же ещё раз».
     */
    async preload(href) {
      const r = await preloadData(href)
      if (r.type === 'loaded') {
        return r.status === 200
          ? { ok: true as const, data: r.data }
          : {
              ok: false as const,
              reason: r.status === 404 ? ('not-found' as const) : ('error' as const),
              status: r.status,
            }
      }
      return { ok: false as const, reason: 'redirect' as const }
    },

    /*
     * Проверка адреса по таблице роутов — см. блок «таблица роутов» выше.
     * Через ядро её получают триггер route-модалок (битый route блокируется
     * до клика) и LoadLink (битая ссылка). Решение владельца — осмотр
     * 1.10-2, №30: проверкой занимается ядро, компоненты только спрашивают.
     */
    resolves: routeResolves,
  }
}

/**
 * Ядро SvelteKit. Хранилище — необязательный аргумент: по умолчанию адрес,
 * потому что у этой среды есть и роутер, и история.
 *
 *     svelteKitCore()                              // цепочка в ?modal=
 *     svelteKitCore(localStorageChain(localStorage))  // адрес чистый
 */
export function svelteKitCore(
  sources: Sources = urlStorage(),
  options: CoreOptions = {},
): ReconfigurableCore {
  return buildCore(svelteKitEngine(), sources, options)
}

/**
 * Маршрут модалки с проверкой на этапе компиляции:
 *
 * ```ts
 * import { resolve } from '$app/paths'
 * const card = { name: 'card', component: Card, route: (p) => resolve('/films/[id]', p) }
 * ```
 *
 * Опечатка в `'/films/[id]'` — ошибка типов, а не 404 у пользователя.
 */
