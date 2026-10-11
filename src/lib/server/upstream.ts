/**
 * Общее для серверных транспортов к внешним API (REST Shikimori, GraphQL и
 * любые следующие) — без знания о конкретном сервисе.
 *
 * `fetch` для внешних запросов берётся ОДИН раз — в хуке `init` сервера
 * (`hooks.server.ts`), до любого рендера. Причина (F8, `docs/design/kit3-upgrade.md`
 * §13.3): в dev SvelteKit на всё время асинхронного SSR-рендера подменяет
 * глобальный `fetch` предупреждающей обёрткой. Транспорт ставит запросы в
 * очередь с паузой, и запрос, рождённый `load` одной страницы, уходил во время
 * рендера другой — Kit предупреждал «fetch во время SSR» от её имени. Брать
 * `globalThis.fetch` при загрузке модуля нельзя: модуль грузится лениво, в том
 * числе посреди чужого рендера, и запомнил бы обёртку навсегда.
 *
 * Без `init` (тесты, утилиты) — `globalThis.fetch` в момент вызова, как раньше.
 */
let captured: typeof globalThis.fetch | undefined

/** Запомнить настоящий `fetch`. Вызывать из `init` в `hooks.server.ts`. */
export function captureUpstreamFetch(fetchImpl: typeof globalThis.fetch = globalThis.fetch): void {
  captured = fetchImpl
}

/** `fetch` для запросов к внешним API: запомненный в `init` или глобальный. */
export function upstreamFetch(): typeof globalThis.fetch {
  return captured ?? globalThis.fetch
}
