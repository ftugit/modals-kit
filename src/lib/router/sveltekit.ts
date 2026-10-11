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

/**
 * 🔴 `page.url` — адрес СТРАНИЦЫ, а не адресная строка. «Мелкая» запись
 * (`goto(…, { shallow: true })` из `$app/navigation`, shallow routing) меняет запись
 * истории и `page.state`, но `page.url` намеренно оставляет прежним. Пагинатор пишет свой адрес именно так (`syncAddress`), поэтому
 * после первой же записи `page.url.searchParams` устаревает: следующая запись
 * сливала ключи с устаревшим срезом и затирала соседний пагинатор, а ссылки
 * строились от старого адреса. Тот же вывод — у ядра модалок
 * (`modals/cores/sveltekit.ts`: «shallow-запись НЕ обновляет `page.url`»).
 *
 * Поэтому в браузере срез берётся у адресной строки, а реактивность ей даёт
 * `createSubscriber` (штатный способ подключить внешний источник к рунам):
 *   • настоящая навигация — зависимость от `page.url` (SvelteKit пишет историю
 *     раньше, чем обновляет `page`, так что `location` к этому моменту свежий);
 *   • собственная «мелкая» запись — `notifyAddressWrite()`;
 *   • Назад/Вперёд по «мелким» записям, где `page.url` не меняется, — `popstate`.
 * На сервере адресной строки нет, а `page.url` там верен: мелких записей не было.
 */
const addressWrites = new Set<() => void>()

const subscribeAddress = createSubscriber((update) => {
  addressWrites.add(update)
  window.addEventListener('popstate', update)
  return () => {
    addressWrites.delete(update)
    window.removeEventListener('popstate', update)
  }
})

function notifyAddressWrite(): void {
  for (const update of addressWrites) update()
}

/**
 * Search текущего рендера. Реактивен: чтение внутри `$derived`/`$effect`
 * перезапускается на каждой навигации (в том числе back/forward).
 * На сервере отдаёт адрес запроса — как `app.search` исходника на SSR.
 */
export function currentSearch(): Record<string, unknown> {
  if (!browser) return Object.fromEntries(page.url.searchParams)
  void page.url
  subscribeAddress()
  return Object.fromEntries(new URLSearchParams(window.location.search))
}

/** Путь текущего рендера — для `action` формы без JS (аналог `app.pathname`). */
export function currentPathname(): string {
  return page.url.pathname
}

/**
 * Адрес из среза search: путь + строка запроса + текущий `#фрагмент`. Одна
 * сборка на все записи, чтобы `navigate` и `syncAddress` не разъезжались в формате.
 *
 * Фрагмент берётся у адресной строки: пагинатор меняет только search, а `#якорь`
 * принадлежит странице (ссылка «к разделу», shallow-флаги и т. п.). Без него каждая
 * запись адреса стирала якорь (баг F9, docs/audit/crutches.md). На сервере записей
 * нет — `hrefOf` вызывается только из обработчиков в браузере.
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
  return `${page.url.pathname}${qs ? `?${qs}` : ''}${hash}`
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
 * очередь: shallow-запись до запуска роутера бросает и обрывает
 * гидрацию (F12: адрес `?page.q=` после нативной GET-формы). `onMount` хоста
 * выполняется ДО запуска роутера, а `afterNavigate` — после (и при гидрации, и
 * при монтировании компонента позже), поэтому очередь сбрасывается в первом
 * `afterNavigate`. Срез адреса вычисляется в момент записи, а не постановки.
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
      // В SvelteKit 3 `goto` асинхронен: адресная строка меняется только после
      // разрешения маршрута, а промис разрешается, «когда изменение состояния
      // применено» (https://svelte.dev/docs/kit/$app-navigation#goto). Уведомлять
      // подписчиков раньше — значит отдать им СТАРЫЙ `location`: пагинатор
      // откатывал своё состояние и затирал только что записанный ключ.
      const write = () => {
        void goto(hrefOf(opts.search(currentSearch())), { shallow: true, replace: true, state: page.state }).then(
          notifyAddressWrite,
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
 * `loaded | redirect | error` + `status`, sveltejs/kit#12579).
 *
 * Kit 2.x этот контракт не выполняет: при ошибке загрузчика `preloadData`
 * отдаёт `{type: 'loaded', status: 200}` с данными ТЕКУЩЕЙ страницы
 * (`preload_error` → `clone_page(page)`; sveltejs/kit#12399). Поэтому до
 * перехода на kit 3 ветка `error` срабатывает только при отказе самой
 * предзагрузки (исключение: сеть, чанк), а ошибка загрузчика видна как
 * `loaded` (C4, docs/audit/crutches.md). Признаков из внутренностей 2.x здесь
 * сознательно нет — после обновления kit ветка заработает без правок.
 */
export type PreloadOutcome =
  | { kind: 'loaded'; status: number }
  | { kind: 'redirect'; location: string }
  | { kind: 'error'; status: number | null; message: string }

export async function preloadOutcome(href: string): Promise<PreloadOutcome> {
  // Тип шире объявленного в 2.x: форма 3.x (`type: 'error'`) обязана читаться.
  let r: { type: string; status?: number; location?: string; error?: { message?: string } }
  try {
    r = (await preloadData(href)) as typeof r
  } catch (error) {
    return { kind: 'error', status: null, message: error instanceof Error ? error.message : String(error) }
  }
  if (r.type === 'redirect') return { kind: 'redirect', location: r.location ?? href }
  if (r.type === 'error' || (r.status ?? 200) >= 400) {
    return { kind: 'error', status: r.status ?? null, message: r.error?.message ?? '' }
  }
  return { kind: 'loaded', status: r.status ?? 200 }
}
