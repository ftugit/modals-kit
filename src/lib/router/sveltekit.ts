/**
 * Слой фреймворка: роутер SvelteKit — единственная точка, где библиотека читает адрес.
 *
 * Соответствие исходнику (`SolidHono`): `fastedge/router.tsx` (`useNavigate`,
 * `useLocation`) + `fastedge/context.ts` (`useAppStore().search` / `.pathname`).
 * В порте роль фреймворка играет SvelteKit, то есть `$app/state` и
 * `$app/navigation` — но ровно здесь: компоненты и фичи `$app/*` не импортируют.
 *
 * Почему это важно, а не стилистика: у каждой «своей» копии чтения адреса
 * свой формат и своя реактивность. `window.location.search` внутри `$derived`
 * зависимостей не даёт вовсе — значение застывает на моменте создания, — а
 * `history.pushState` в обход роутера SvelteKit перетирается и предупреждает
 * в консоли. Слой фреймворка убирает оба класса ошибок разом: срез адреса
 * берётся у `$app/state` (реактивно, на SSR — адрес запроса), навигация идёт
 * через `goto`.
 */
import { browser } from '$app/env'
import { afterNavigate, goto, preloadData } from '$app/navigation'
import { page } from '$app/state'
import type { MinimalRouter } from '#lib/paginate/index.js'

/**
 * Видимый адрес — по документации shallow routing SvelteKit 3: `page.url` —
 * адрес СТРАНИЦЫ, «мелкая» запись (`goto(…, { shallow: true })`) его не меняет
 * и кладёт адресную строку в `page.shallow.url`; Назад/Вперёд по таким записям
 * восстанавливает `page.shallow`. Оба поля реактивны, так что чтение внутри
 * `$derived` перестраивается и после своих записей пагинатора, и после
 * навигации — без своего `popstate` и ручных уведомлений.
 * На сервере `page.shallow` нет, `page.url` — адрес запроса.
 * https://svelte.dev/docs/kit/shallow-routing
 */
const visibleUrl = (): (typeof page)['url'] => page.shallow?.url ?? page.url

/**
 * Search видимого адреса. Реактивен: чтение внутри `$derived`/`$effect`
 * перезапускается на каждой навигации и «мелкой» записи (в том числе back/forward).
 * На сервере — адрес запроса, как `app.search` исходника на SSR.
 */
export function currentSearch(): Record<string, unknown> {
  return Object.fromEntries(visibleUrl().searchParams)
}

/** Путь текущего рендера — для `action` формы без JS (аналог `app.pathname`). */
export function currentPathname(): string {
  return page.url.pathname
}

/**
 * Адрес из среза search: путь + строка запроса + текущий `#фрагмент`. Одна
 * сборка на все записи, чтобы `navigate` и `syncAddress` не разъезжались в формате.
 *
 * Фрагмент берётся у адресной строки в момент записи: пагинатор меняет только
 * search, а `#якорь` принадлежит странице (ссылка «к разделу» и т. п.). Без него
 * каждая запись стирала якорь (баг F9, docs/audit/crutches.md).
 * Не из `page.*`: клик по ссылке-якорю обновляет только `page.url`, а
 * `page.shallow` после «мелкой» записи остаётся прежним — следующая запись
 * стёрла бы новый якорь (SvelteKit 3.0.1, проба ход 17; решение владельца — A).
 * Реактивность здесь не нужна: `hrefOf` вызывается только из обработчиков в браузере.
 */
function hrefOf(search: Record<string, unknown>): string {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(search)) {
    if (v == null) continue
    if (Array.isArray(v)) for (const item of v) params.append(k, String(item))
    else params.set(k, String(v))
  }
  const qs = params.toString()
  const hash = browser ? window.location.hash : ''
  return `${visibleUrl().pathname}${qs ? `?${qs}` : ''}${hash}`
}

/**
 * Роутер под контракт URL-транспорта пагинатора (`PaginatorAdapter.setRouter`).
 *
 * Хост отдаёт его адаптеру сам — по признаку `setRouter` (канон: `bindsUrl`).
 * Фичи про существование адреса не знают: ни роутера, ни разбора `?page`.
 *
 * Вызывать ПРИ ИНИЦИАЛИЗАЦИИ компонента (верхний уровень `<script>`): роутер
 * регистрирует `afterNavigate`, а это функция жизненного цикла.
 *
 * Запись адреса (`syncAddress`) до готовности роутера SvelteKit ставится в
 * очередь (F12: адрес `?page.q=` после нативной GET-формы). Навигация до запуска
 * роутера по-прежнему запрещена (`navigation_before_start`); `onMount` хоста
 * выполняется ДО запуска, а `afterNavigate` — после (и при гидрации, и при
 * монтировании компонента позже), поэтому очередь сбрасывается в первом
 * `afterNavigate`. В 3.0.1 без очереди запись проходит лишь потому, что `goto`
 * успевает несколько раз уступить микрозадачу до проверки — это тайминг
 * внутренностей, а не контракт. Срез адреса вычисляется в момент записи.
 * https://svelte.dev/docs/kit/$app-navigation#afterNavigate
 */
export function svelteKitRouter(): MinimalRouter {
  let ready = false
  let queued: Array<() => void> = []
  afterNavigate(() => {
    if (ready) return
    ready = true
    const run = queued
    queued = []
    for (const write of run) write()
  })
  return {
    navigate(opts) {
      const next = opts.search(currentSearch())
      // Скролл и фокус принадлежат контейнеру хоста, не странице → `reset: false`
      // (в исходнике то же самое: `resetScroll: false`).
      void goto(hrefOf(next), { replace: opts.replace ?? true, reset: false })
    },
    /**
     * Замена ТЕКУЩЕЙ записи истории без перехода: shallow-`goto` SvelteKit
     * (`shallow: true, replace: true`) — адрес меняется, но загрузка не перезапускается, разметка не
     * перерисовывается, браузер ничего не запрашивает. Нужна там, где адрес надо
     * ПОПРАВИТЬ, а не «пойти» (например, убрать пустые ключи нативной формы).
     * Соседний `history.replaceState` не годится: SvelteKit не узнал бы о правке
     * и вернул бы старый адрес на следующем чтении.
     */
    syncAddress(opts) {
      // `goto` асинхронен; читатели узнают о записи из `page.shallow`, который
      // SvelteKit обновляет, когда запись применена — не раньше (иначе пагинатор
      // откатывал бы своё состояние к старому адресу).
      const write = () => {
        void goto(hrefOf(opts.search(currentSearch())), { shallow: true, replace: true, state: page.state })
      }
      if (ready) write()
      else queued.push(write)
    },
    currentSearch,
  }
}

/**
 * Флаг «мелкой» записи истории (shallow routing) для UI, у которого «Назад»
 * должен ЗАКРЫВАТЬ, а не уводить со страницы: мобильная панель и т. п.
 *
 * Запись — shallow-`goto` из `$app/navigation` с прежним `page.state` плюс флаг:
 * чужие ключи (цепочка модалок) едут дальше. Нативный `history.pushState` здесь
 * не годится: SvelteKit о такой записи не знает, предупреждает в консоли и
 * копирует свои служебные ключи (`sveltekit:history`) в новую запись (баг F6,
 * docs/audit/crutches.md). Снять флаг — `history.back()`, как в документации:
 * https://svelte.dev/docs/kit/shallow-routing
 */
export function shallowFlag(key: string): { readonly on: boolean; push(): void } {
  const state = () => page.state as Record<string, unknown>
  return {
    get on() {
      return Boolean(state()[key])
    },
    push() {
      if (state()[key]) return
      // Адрес — ровно адресная строка: `''` SvelteKit разрешает через
      // `new URL('', document.baseURI)`, а это теряет `#якорь`.
      void goto(window.location.href, { shallow: true, state: { ...state(), [key]: true } })
    },
  }
}

/**
 * Исход предзагрузки адреса — по контракту SvelteKit 3 (`preloadData`:
 * `loaded | redirect | error` + `status`, sveltejs/kit#12579). Отказ самой
 * предзагрузки (сеть, чанк) — исключение, тоже `error`.
 */
export type PreloadOutcome =
  | { kind: 'loaded'; status: number }
  | { kind: 'redirect'; location: string }
  | { kind: 'error'; status: number | null; message: string }

export async function preloadOutcome(href: string): Promise<PreloadOutcome> {
  let r: Awaited<ReturnType<typeof preloadData>>
  try {
    r = await preloadData(href)
  } catch (error) {
    return { kind: 'error', status: null, message: error instanceof Error ? error.message : String(error) }
  }
  if (r.type === 'redirect') return { kind: 'redirect', location: r.location }
  if (r.type === 'error') return { kind: 'error', status: r.status, message: r.error.message }
  return { kind: 'loaded', status: r.status }
}
