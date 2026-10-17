/**
 * Адаптер пагинатора к SvelteKit: роутер URL-транспорта (`PaginatorAdapter.setRouter`)
 * и реактивный срез адреса для UI.
 *
 * Адрес пишет общий писатель `#lib/address/sveltekit.js`: свой писатель здесь
 * означал бы две очереди, и записи пагинатора и модалок снова затирали бы
 * друг друга (F41). Соответствие исходнику (`SolidHono`): `fastedge/router.tsx`
 * (`useNavigate`, `useLocation`) + `fastedge/context.ts` (`useAppStore().search` /
 * `.pathname`).
 */
import { afterNavigate } from '$app/navigation'
import { page } from '$app/state'
import { visibleAddress, writeAddress } from '#lib/address/sveltekit.js'
import type { MinimalRouter } from '../adapter-url'

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
        { replace: opts.replace ?? true, load: true, owner: opts.owner },
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
          { replace: true, owner: opts.owner },
        )
      }
      if (ready) write()
      else queued.push(write)
    },
    currentSearch,
  }
}
