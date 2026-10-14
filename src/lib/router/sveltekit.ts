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
import { navigating, page } from '$app/state'
import { createSubscriber } from 'svelte/reactivity'
import type { MinimalRouter } from '#lib/paginate/index.js'
import { IDLE_TASK, type TaskState } from '#lib/task/index.js'
import { watch } from './watch.svelte'
import { createLayerLinks } from './layer-links'
import {
  createAddressWriter,
  type AddressChange,
  type AddressSnapshot,
  type AddressWriteOptions,
} from './address'

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

/* ── единый писатель адреса (F41) ─────────────────────────────────────
 * Все записи адреса приложения — пагинатор, модалки (`cores/sveltekit.ts`),
 * флаги «мелких» записей — идут через ОДНОГО писателя (`./address.ts`): иначе
 * вторая запись, пока первая в полёте, строилась бы из устаревшего `page.*` и
 * затирала чужие ключи. Здесь только привязка к SvelteKit 3:
 *  • реальность — `page.shallow?.url ?? page.url` и `page.state`;
 *  • коммит — `goto` (`shallow` для записи без загрузки);
 *  • фрагмент — адресная строка в момент отправки (решение владельца A, C1);
 *  • Назад/Вперёд — событие `popstate`: по «мелким» записям одной страницы
 *    SvelteKit 3.0.1 не вызывает навигационных хуков (`client.js`, ветка
 *    `if (shallow)` обработчика `popstate`), поэтому `afterNavigate` здесь не годится.
 * На сервере писателя нет: записей там не бывает, а состояние модуля общее для
 * всех запросов.
 * https://svelte.dev/docs/kit/shallow-routing
 */
/**
 * Navigation API — только для связок слоёв (ход 106): ключ записи и событие
 * обхода с записью, с которой ушли. Baseline 2026-01 (Chrome/Edge, Firefox 147,
 * Safari 26.2); без него перенос делает только свой шаг назад, как раньше.
 * https://developer.mozilla.org/en-US/docs/Web/API/Navigation_API
 */
const nav: Navigation | undefined = browser && 'navigation' in window ? window.navigation : undefined
const links = nav ? createLayerLinks(sessionStorageOrUndefined()) : null

function sessionStorageOrUndefined(): Storage | undefined {
  try {
    return window.sessionStorage
  } catch {
    return undefined // запрет хранилища: связки живут в памяти вкладки
  }
}

const aliveKeys = (): string[] => (nav ? nav.entries().map((e) => e.key) : [])

const writer = browser
  ? createAddressWriter({
      // Копия: у `page.url` Kit свой тип (`ReadonlyURLSearchParams`), ядру нужен URL.
      read: () => ({ url: new URL(visibleUrl().href), state: page.state as Record<string, unknown> }),
      commit: ({ href, state, replace, load }) => {
        if (load)
          // Скролл и фокус принадлежат контейнеру хоста, не странице → `reset: false`.
          return goto(href, { replace, reset: false, state: state as App.PageState })
        // «Мелкое» добавление записи — это слой (модалка, флаг панели, список
        // селекта): запоминаем, поверх какой записи он открыт.
        const base = !replace ? nav?.currentEntry?.key : undefined
        return goto(href, { shallow: true, replace, state: state as App.PageState }).then(() => {
          const layer = nav?.currentEntry?.key
          if (!links || !base || !layer || layer === base) return
          links.link(layer, base)
          // Новая запись отрезала «вперёд» — связки выпавших записей не нужны.
          links.prune(aliveKeys())
        })
      },
      hash: () => window.location.hash,
      traverse: (delta) => window.history.go(delta),
      here: () => new URL(window.location.href),
    })
  : null

/**
 * Запись, с которой ушёл обход, — если она и запись назначения из одной стопки
 * слоёв. `currententrychange` приходит раньше `popstate` (проверено в
 * Chromium, Firefox и WebKit, ход 103), и его `from` — закрытая запись с
 * актуальным адресом; `popstate` передаёт её писателю.
 */
let traversedFrom: { url: URL; hash: string } | null = null
if (writer && nav && links) {
  links.prune(aliveKeys())
  nav.addEventListener('currententrychange', (event) => {
    if (event.navigationType !== 'traverse') return
    const to = nav.currentEntry
    // Firefox в iframe шлёт обход второй раз с `from === currentEntry`
    // (lit-ui-router #1192): это не обход.
    if (!to || event.from === to || event.from.key === to.key || !event.from.url) {
      traversedFrom = null
      return
    }
    if (!links.sameStack(event.from.key, to.key)) {
      traversedFrom = null
      return
    }
    const url = new URL(event.from.url)
    traversedFrom = { url, hash: url.hash }
  })
  // Как SvelteKit: в хранилище — когда вкладка уходит в фон или закрывается.
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') links.persist()
  })
  window.addEventListener('pagehide', () => links.persist())
}
if (writer)
  window.addEventListener('popstate', () => {
    const from = traversedFrom
    traversedFrom = null
    writer.external(from ?? undefined)
  })
// Kit применяет обход после `popstate` асинхронно; перенос адреса страницы
// после закрытия слоя ждёт именно этого (ход 100, `address.ts`).
if (writer) watch(() => [page.url, page.shallow, page.state], () => writer.applied())

/**
 * Якорь страницы при занятой записи истории (F39).
 *
 * Клик по `#якорю` браузер (и SvelteKit 3.0.1, ветка «отличается только
 * фрагментом» обработчика кликов) превращает в НОВУЮ запись истории — с копией
 * состояния текущей. Если текущая запись чья-то «мелкая» (открыта модалка,
 * мобильная панель), копия тоже говорит «открыто», а «закрыть» = шаг назад
 * попадает на запись открытия: окно остаётся, адрес теряет якорь.
 *
 * Поэтому, пока у записи есть состояние, якорь её ЗАМЕНЯЕТ — тем же писателем,
 * что и остальные записи адреса (состояние и чужие ключи сохраняются), а
 * прокрутку к цели делаем сами, как SvelteKit для повторного клика по тому же
 * якорю (`scrollIntoView` + `focus`). Фрагмент принадлежит странице (решение
 * владельца A, C1), отдельный шаг истории ради него при открытом слое не нужен.
 * Без состояния (обычная запись) — поведение браузера и SvelteKit как есть.
 *
 * Слушатель — на фазе перехвата окна (раньше любого узла): обработчик SvelteKit висит на
 * контейнере приложения и уважает `defaultPrevented`.
 */
function onHashLinkClick(event: MouseEvent): void {
  if (!writer || event.defaultPrevented || event.button !== 0) return
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  const link = event.target instanceof Element ? event.target.closest('a[href]') : null
  if (!(link instanceof HTMLAnchorElement) || link.hasAttribute('download')) return
  if (link.target && link.target !== '_self') return
  const to = new URL(link.href)
  const here = new URL(window.location.href)
  if (!to.hash || to.origin !== here.origin || to.pathname !== here.pathname || to.search !== here.search) return
  if (Object.keys(writer.visible().state).length === 0) return
  event.preventDefault()
  void writeAddress((cur) => ({ url: `${cur.url.pathname}${cur.url.search}${to.hash}` }), { replace: true })
  const id = decodeURIComponent(to.hash.slice(1))
  const target = id ? document.getElementById(id) : null
  if (target) {
    target.scrollIntoView()
    target.focus({ preventScroll: true })
  } else if (id === '' || id === 'top') {
    window.scrollTo({ top: 0 })
  }
}
if (writer) window.addEventListener('click', onHashLinkClick, true)

// Реактивность намерения: читатель внутри `$derived`/`$effect` перезапускается и
// на собственной записи (до её применения), и на изменении `page.*`.
const trackIntent = writer ? createSubscriber((update) => writer.subscribe(update)) : () => {}

/**
 * Видимый адрес с учётом записей, которые ещё не применены. Внутренний
 * контракт слоя фреймворка (модалки, пагинатор, флаги), не API приложения.
 * @internal
 */
export function visibleAddress(): AddressSnapshot {
  if (!writer) return { url: new URL(page.url.href), state: page.state as Record<string, unknown> }
  trackIntent()
  return writer.visible()
}

/**
 * Записать адрес через общего писателя. На сервере — прямой `goto`, как
 * раньше: он сам сообщит, что навигации на сервере нет.
 * @internal
 */
export function writeAddress(
  change: (current: AddressSnapshot) => AddressChange,
  options: AddressWriteOptions,
): Promise<void> {
  if (writer) return writer.write(change, options)
  const next = change(visibleAddress())
  return goto(String(next.url), {
    replace: options.replace,
    ...(options.load ? {} : { shallow: true }),
    state: (next.state ?? page.state) as App.PageState,
  })
}

/**
 * Свой шаг по истории ещё не завершён (ждёт записей до него или своего
 * `popstate`). Смена `page.*` в это окно — применение более ранней записи, а не
 * итог обхода: тот, кто ждёт итог обхода, должен её пропустить.
 * @internal
 */
export function addressTraversing(): boolean {
  return writer?.traversing ?? false
}

/**
 * Шаг по истории после записей, сделанных до него: иначе «закрыть» сразу после
 * «открыть» уходило бы назад раньше, чем запись открытия попала в историю.
 * @internal
 */
export function goAddress(delta: number): void {
  if (writer) writer.go(delta)
  else window.history.go(delta)
}

/**
 * Объявить ключи строки запроса, которые принадлежат слою (например, цепочка
 * модалок `?modal=`): при закрытии слоя писатель переносит на запись назначения
 * адрес страницы, но не эти ключи (ход 100, `address.ts`).
 * @internal
 */
export function claimLayerKeys(test: (key: string) => boolean): () => void {
  return writer ? writer.layerKeys(test) : () => {}
}

/**
 * Search видимого адреса. Реактивен: чтение внутри `$derived`/`$effect`
 * перезапускается на каждой навигации и «мелкой» записи (в том числе back/forward).
 * Учитывает записи, которые ещё в полёте (F41). На сервере — адрес запроса,
 * как `app.search` исходника на SSR.
 */
export function currentSearch(): Record<string, unknown> {
  return Object.fromEntries(visibleAddress().url.searchParams)
}

/** Видимый адрес целиком (с учётом «мелких» записей) — сравнить «до» и «после». */
export function visibleHref(): string {
  return visibleUrl().href
}

/**
 * Куда на самом деле ведёт `href` ссылки: разбор от ВИДИМОГО адреса
 * (`?modal=card`, `details`, `#top` — относительно текущей страницы, в том
 * числе после «мелкой» записи). `local` — тот же origin, то есть страница
 * этого приложения, а не чужой сайт. Пустой или неразборчивый адрес — `null`.
 */
export function resolveHref(href: string | null | undefined): { url: URL; local: boolean } | null {
  if (!href) return null
  const base = visibleUrl()
  try {
    const url = new URL(href, base.href)
    return { url, local: url.origin === base.origin }
  } catch {
    return null
  }
}

/**
 * Адаптер `#lib/task` для переходов SvelteKit: идёт ли переход ИМЕННО на этот
 * адрес. Читает `navigating` (реактивно: вызов внутри `$derived` или разметки
 * перестраивается на начало и конец перехода).
 *
 * - Адрес ссылки разрешается от ВИДИМОГО адреса (`?modal=card` — относительно
 *   текущей страницы, в том числе после «мелкой» записи).
 * - Совпадение — origin, путь и query; якорь не в счёт.
 * - Переход, который выгружает документ (`willUnload`), — дело браузера: его
 *   полоска уже идёт, своя не нужна.
 * - На сервере `navigating` пуст — всегда покой (разметка без JS чистая).
 *
 * `navigating` бывает непустым и у «мелких» записей адреса (модалки, пагинатор:
 * 1–2 мс, замер хода 129) — поэтому `Link` показывает индикатор с задержкой.
 */
export function linkTask(href: string | null | undefined): TaskState {
  const to = navigating.to?.url
  if (!to || navigating.willUnload) return IDLE_TASK
  const target = resolveHref(href)?.url
  if (!target) return IDLE_TASK
  if (target.origin !== to.origin || target.pathname !== to.pathname || target.search !== to.search) return IDLE_TASK
  return { status: 'pending', scope: 'local', label: 'Переход' }
}

/** Путь текущего рендера — для `action` формы без JS (аналог `app.pathname`). */
export function currentPathname(): string {
  return page.url.pathname
}

/**
 * Адрес из среза search: путь + строка запроса. Одна сборка на все записи,
 * чтобы `navigate` и `syncAddress` не разъезжались в формате.
 *
 * `#фрагмент` сюда не входит: его дописывает писатель в момент ОТПРАВКИ, из
 * адресной строки (баг F9, решение владельца A). Пагинатор меняет только
 * search, а якорь принадлежит странице; из `page.*` его брать нельзя — клик по
 * ссылке-якорю обновляет только `page.url`.
 */
function hrefOf(pathname: string, search: Record<string, unknown>): string {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(search)) {
    if (v == null) continue
    if (Array.isArray(v)) for (const item of v) params.append(k, String(item))
    else params.set(k, String(v))
  }
  const qs = params.toString()
  return `${pathname}${qs ? `?${qs}` : ''}`
}

const searchOf = (url: URL): Record<string, unknown> => Object.fromEntries(url.searchParams)

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
      // Переход с загрузкой — тоже через писателя: следующая «мелкая» запись
      // (модалка) строится от его цели и уходит после него, а состояние текущей
      // записи (цепочка модалок) переносится, а не теряется.
      // Скролл и фокус — `reset: false` в коммите писателя.
      return writeAddress(
        (cur) => ({ url: hrefOf(cur.url.pathname, opts.search(searchOf(cur.url))) }),
        { replace: opts.replace ?? true, load: true },
      )
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
      // Срез — намерение писателя, а не `page.*`: пока чужая запись (модалка) в
      // полёте, `page.*` ещё старый, и её ключи были бы затёрты (F41). Состояние
      // записи не копируется целиком — оно остаётся тем, что видит писатель.
      const write = () => {
        void writeAddress(
          (cur) => ({ url: hrefOf(cur.url.pathname, opts.search(searchOf(cur.url))) }),
          { replace: true },
        )
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
 * docs/audit/crutches.md). Снять флаг — шаг назад по истории, как в документации;
 * внутри слоя — `goAddress(-1)` по `visibleAddress()`: запись флага может ещё
 * ждать в очереди писателя, и прямой `history.back()` ушёл бы раньше неё:
 * https://svelte.dev/docs/kit/shallow-routing
 */
export function shallowFlag(key: string): { readonly on: boolean; push(): void } {
  return {
    // Применённая запись, а не намерение: по `on` оболочка решает, звать ли
    // `history.back()`, а шаг назад до применения записи увёл бы со страницы.
    get on() {
      return Boolean((page.state as Record<string, unknown>)[key])
    },
    push() {
      if (visibleAddress().state[key]) return
      // Адрес — видимый (с записями в полёте), `#якорь` писатель берёт из
      // адресной строки при отправке; состояние — слияние с чужими ключами.
      void writeAddress((cur) => ({ url: cur.url, state: { ...cur.state, [key]: true } }), {
        replace: false,
      })
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
