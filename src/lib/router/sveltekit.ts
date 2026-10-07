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
import { goto } from '$app/navigation'
import { page } from '$app/state'
import type { MinimalRouter } from '$lib/paginate'

/**
 * Search текущего рендера. Реактивен: чтение внутри `$derived`/`$effect`
 * перезапускается на каждой навигации (в том числе back/forward).
 * На сервере отдаёт адрес запроса — как `app.search` исходника на SSR.
 */
export function currentSearch(): Record<string, unknown> {
  return Object.fromEntries(page.url.searchParams)
}

/** Путь текущего рендера — для `action` формы без JS (аналог `app.pathname`). */
export function currentPathname(): string {
  return page.url.pathname
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
      const params = new URLSearchParams()
      for (const [k, v] of Object.entries(next)) {
        if (v != null) params.set(k, String(v))
      }
      const qs = params.toString()
      // Скролл принадлежит контейнеру хоста, не странице → noScroll
      // (в исходнике то же самое: `resetScroll: false`).
      void goto(`${page.url.pathname}${qs ? `?${qs}` : ''}`, {
        replaceState: opts.replace ?? true,
        noScroll: true,
        keepFocus: true,
      })
    },
    currentSearch,
  }
}
