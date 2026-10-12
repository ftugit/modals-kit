import { dbHandle } from '#lib/db/sveltekit/index.js'
import { DEMO_PRINCIPAL, db } from '#lib/server/db.js'
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
 * Доверенный контекст: principal выдаёт только сервер (здесь — демо-«автор»; с
 * авторизацией — пользователь из сессии), `signal` берёт сам рантайм (ушёл со страницы →
 * SQL отменяется). Роль из query-параметра появиться не может физически: DataContext
 * собирает пакет.
 *
 * Пользователь определяется на каждом запросе, `locals.db` есть везде. Сама БД при этом
 * не поднимается: `db` открывает соединение при первом запросе к ней (`lazyDriver`),
 * поэтому страницы без БД за неё не платят.
 */
export const handle: Handle = dbHandle({ db, principal: () => DEMO_PRINCIPAL })
