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
import { createSubscriber } from 'svelte/reactivity'
import type { MinimalRouter } from '#lib/paginate/index.js'
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
const writer = browser
  ? createAddressWriter({
      // Копия: у `page.url` Kit свой тип (`ReadonlyURLSearchParams`), ядру нужен URL.
      read: () => ({ url: new URL(visibleUrl().href), state: page.state as Record<string, unknown> }),
      commit: ({ href, state, replace, load }) =>
        load
          ? // Скролл и фокус принадлежат контейнеру хоста, не странице → `reset: false`.
            goto(href, { replace, reset: false, state: state as App.PageState })
          : goto(href, { shallow: true, replace, state: state as App.PageState }),
      hash: () => window.location.hash,
      traverse: (delta) => window.history.go(delta),
    })
  : null
if (writer) window.addEventListener('popstate', () => writer.external())

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
 * Search видимого адреса. Реактивен: чтение внутри `$derived`/`$effect`
 * перезапускается на каждой навигации и «мелкой» записи (в том числе back/forward).
 * Учитывает записи, которые ещё в полёте (F41). На сервере — адрес запроса,
 * как `app.search` исходника на SSR.
 */
export function currentSearch(): Record<string, unknown> {
  return Object.fromEntries(visibleAddress().url.searchParams)
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
