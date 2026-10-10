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
import { browser } from '$app/environment'
import { goto, replaceState } from '$app/navigation'
import { page } from '$app/state'
import { createSubscriber } from 'svelte/reactivity'
import type { MinimalRouter } from '$lib/paginate'

/**
 * 🔴 `page.url` — адрес СТРАНИЦЫ, а не адресная строка. «Мелкая» запись
 * (`replaceState`/`pushState` из `$app/navigation`, shallow routing) меняет запись
 * истории и `page.state`, но `page.url` намеренно оставляет прежним (исходник
 * SvelteKit: `replaceState` сохраняет `page.url.href` в записи и не трогает
 * `page.url`). Пагинатор пишет свой адрес именно так (`syncAddress`), поэтому
 * после первой же записи `page.url.searchParams` устаревает: следующая запись
 * сливала ключи с устаревшим срезом и затирала соседний пагинатор, а ссылки
 * строились от старого адреса. Тот же вывод — у ядра модалок
 * (`modals/cores/sveltekit.ts`: «`pushState()` НЕ обновляет `page.url`»).
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
 * Адрес из среза search: путь + строка запроса. Одна сборка на все записи,
 * чтобы `navigate` и `syncAddress` не разъезжались в формате.
 */
function hrefOf(search: Record<string, unknown>): string {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(search)) {
    if (v == null) continue
    if (Array.isArray(v)) for (const item of v) params.append(k, String(item))
    else params.set(k, String(v))
  }
  const qs = params.toString()
  return `${page.url.pathname}${qs ? `?${qs}` : ''}`
}

/**
 * Роутер под контракт URL-транспорта пагинатора (`PaginatorAdapter.setRouter`).
 *
 * Хост отдаёт его адаптеру сам — по признаку `setRouter` (канон: `bindsUrl`).
 * Фичи про существование адреса не знают: ни роутера, ни разбора `?page`.
 */
export function svelteKitRouter(): MinimalRouter {
  return {
    navigate(opts) {
      const next = opts.search(currentSearch())
      // Скролл принадлежит контейнеру хоста, не странице → noScroll
      // (в исходнике то же самое: `resetScroll: false`).
      void goto(hrefOf(next), {
        replaceState: opts.replace ?? true,
        noScroll: true,
        keepFocus: true,
      })
    },
    /**
     * Замена ТЕКУЩЕЙ записи истории без перехода: `replaceState` слоя SvelteKit
     * (не `goto`) — адрес меняется, но загрузка не перезапускается, разметка не
     * перерисовывается, браузер ничего не запрашивает. Нужна там, где адрес надо
     * ПОПРАВИТЬ, а не «пойти» (например, убрать пустые ключи нативной формы).
     * Соседний `history.replaceState` не годится: SvelteKit не узнал бы о правке
     * и вернул бы старый адрес на следующем чтении.
     */
    syncAddress(opts) {
      replaceState(hrefOf(opts.search(currentSearch())), page.state)
      notifyAddressWrite()
    },
    currentSearch,
  }
}
