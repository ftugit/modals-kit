import { sequence, type Handle, type ServerInit } from '@sveltejs/kit/hooks'
import { dbHandle } from '#lib/db/sveltekit/index.js'
import { DEMO_PRINCIPAL, db } from '#lib/server/db.js'
import { componentFormsHandle } from '#hooks/component-form/server.js'
// Транспорт источника БД: первая отрисовка списка читается напрямую из слоя, а не
// через self-fetch. Ставится здесь, а не в лоадере страницы: лоадер `/paginator`
// — universal, его граф доходит и до браузера, а `#lib/server/*` — модули
// серверные. Это side-effect импорта на весь процесс: оба демо и API получают
// транспорт независимо от того, какой роут обрабатывает запрос.
import '#lib/server/db-list.js'
import { captureUpstreamFetch } from '#lib/server/fetch.js'

/**
 * Один раз при старте сервера, до любого рендера: настоящий `fetch` для
 * транспортов к внешним API (F8 — в dev Kit подменяет глобальный `fetch` на
 * время SSR-рендера, `#lib/server/fetch.js`).
 * https://svelte.dev/docs/kit/hooks#init
 */
export const init: ServerInit = () => {
  captureUpstreamFetch()
}

/**
 * Доверенный контекст БД + маршрутно-независимый приём POST всех `*.form.server.ts`.
 */
export const handle: Handle = sequence(
  dbHandle({ db, principal: () => DEMO_PRINCIPAL }),
  componentFormsHandle,
)
