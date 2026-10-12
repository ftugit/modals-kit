import { dbHandle } from '#lib/db/sveltekit/index.js'
import { DEMO_PRINCIPAL, getRuntime } from '#lib/server/db.js'
// Транспорт источника БД: первая отрисовка списка читается напрямую из слоя, а не
// через self-fetch. Ставится здесь, а не в лоадере страницы: лоадер `/paginator`
// — universal, его граф доходит и до браузера, а `#lib/server/*` — модули
// серверные. Это side-effect импорта на весь процесс: оба демо и API получают
// транспорт независимо от того, какой роут обрабатывает запрос.
import '#lib/server/db-list.js'
import { captureUpstreamFetch } from '#lib/server/upstream.js'
import type { Handle, ServerInit } from '@sveltejs/kit/hooks'

/**
 * Один раз при старте сервера, до любого рендера: настоящий `fetch` для
 * транспортов к внешним API (F8 — в dev Kit подменяет глобальный `fetch` на
 * время SSR-рендера, `#lib/server/upstream.ts`).
 * https://svelte.dev/docs/kit/hooks#init
 */
export const init: ServerInit = () => {
  captureUpstreamFetch()
}

/**
 * Доверенный контекст: principal выдаёт только сервер (здесь — демо-«автор»),
 * `signal` берёт сам рантайм (ушёл со страницы → SQL отменяется). Роль из
 * query-параметра появиться не может физически: DataContext собирает пакет.
 *
 * Контекст нужен всем путям демо: и странице, и /db-demo/submit (перехваченная
 * отправка формы), и /api/db-posts (доводка страниц пагинатора). Иначе догрузка
 * пошла бы без принципа и показала бы другое, чем первая страница.
 *
 * `db` — фабрика: PGlite поднимается только для `paths`, а не на каждый запрос
 * приложения. Вне `paths` пакет кладёт в `locals.dbCtx` гостевой контекст и не
 * трогает БД (C1: хук больше не повторяет фильтр путей `dbHandle`).
 */
export const handle: Handle = dbHandle({
  db: async () => (await getRuntime()).db,
  principal: () => DEMO_PRINCIPAL,
  paths: ['/db-demo', '/api/db-posts'],
})
