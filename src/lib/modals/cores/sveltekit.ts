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
import { browser } from '$app/env'
import { goto, preloadData } from '$app/navigation'
import { page } from '$app/state'
import { buildCore, type CoreOptions, type ReconfigurableCore } from '../build'
import type { ChainEngine } from '../engine'
import { urlStorage } from '../storages'
import type { Sources } from '../build'
import type { ModalCore } from '../core-contract'
import { makeRouteResolves } from './routes'
import { watch } from '../svelte/watch.svelte'

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
 * Адрес и состояние записи — только штатные `page.*` SvelteKit 3
 * (https://svelte.dev/docs/kit/shallow-routing):
 *   • видимый адрес — `page.shallow?.url ?? page.url`: после shallow-`goto`
 *     `page.url` по-прежнему описывает отрисованную страницу, а адресную
 *     строку описывает `page.shallow`;
 *   • состояние записи — `page.state`; при Назад/Вперёд по shallow-записям
 *     фреймворк сам восстанавливает и `page.state`, и `page.shallow`.
 * На сервере `page.shallow` нет, а `page.state` — пустой объект: мелких
 * записей ещё не было.
 *
 * 🔴 «Читаю своё». В Kit 3 `goto(…, { shallow })` асинхронен: запись истории
 * и `page.*` меняются только после разрешения маршрута. Ядро же пишет и сразу
 * перечитывает адрес/состояние (`build.ts`: запись → `notify()`), а следующая
 * запись сливает чужие ключи с `state()`. Поэтому до применения записи
 * движок отдаёт ровно то, что записал; после — снова `page.*`. Контракт
 * `ChainEngine` остаётся синхронным, обходов на внутренностях роутера
 * (`history.state`, `window.location`) нет.
 */
export function svelteKitEngine(): ChainEngine {
  let pending: { url: URL; state: Record<string, unknown> } | null = null
  let seq = 0

  const write = (url: string, state: Record<string, unknown>, replace: boolean): void => {
    const mine = ++seq
    pending = { url: new URL(url, (page.shallow?.url ?? page.url).href), state }
    // Отказ `goto` (маршрут не найден) не глотаем: он всплывёт как раньше.
    void goto(url, { shallow: true, replace, state: state as App.PageState }).finally(() => {
      if (seq === mine) pending = null
    })
  }

  return {
    name: 'sveltekit',
    location() {
      const u = pending?.url ?? page.shallow?.url ?? page.url
      return { pathname: u.pathname, search: u.search }
    },

    // Shallow-запись — только через `goto` из $app/navigation: прямой
    // history.pushState роутер SvelteKit перетрёт и предупредит в консоли.
    pushState: (url, state) => write(url, state, false),
    replaceState: (url, state) => write(url, state, true),

    state: () => pending?.state ?? (page.state as Record<string, unknown>),

    /**
     * На сервере внешней навигации не бывает — метода просто нет,
     * и ядро узнает об этом через контракт, а не через исключение.
     *
     * Внешнее изменение — это смена `page.url`/`page.shallow`/`page.state`:
     * Назад/Вперёд (в том числе по shallow-записям, где навигационные хуки не
     * вызываются) и обычная навигация. Реактивный эффект срабатывает ПОСЛЕ
     * того, как фреймворк обновил `page`, поэтому ядро читает уже новое
     * состояние — отсрочка на микрозадачу, нужная в 2.x, больше не нужна.
     * Срабатывает и на применение собственной записи — повторное чтение
     * даёт то же состояние. `pending` здесь НЕ сбрасывается: при двух
     * записях в полёте применение первой сбросило бы вторую. Сброс — только
     * в `finally` последней записи (обход истории прерывает незавершённую
     * запись, и её промис тоже разрешается).
     */
    onPopState: browser ? (fn) => watch(() => [page.url, page.shallow, page.state], fn) : undefined,

    // Нет `go` → нет истории → адаптер не отдаст `back`, и закрытие
    // пойдёт через replace. Ровно то, что нужно при SSR.
    go: browser ? (delta) => window.history.go(delta) : undefined,

    /**
     * Исполняет load() самой страницы маршрута. Канонический приём shallow
     * routing из документации SvelteKit — и он же снимает дублирование
     * «страница грузит своё, модалка грузит то же ещё раз».
     *
     * Исходы `preloadData`: `loaded` | `redirect` | `error` (ошибка загрузчика —
     * со статусом, sveltejs/kit#12579).
     */
    async preload(href) {
      const r = await preloadData(href)
      if (r.type === 'redirect') return { ok: false as const, reason: 'redirect' as const }
      if (r.type === 'loaded' && r.status === 200) return { ok: true as const, data: r.data }
      return {
        ok: false as const,
        reason: r.status === 404 ? ('not-found' as const) : ('error' as const),
        status: r.status,
      }
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
