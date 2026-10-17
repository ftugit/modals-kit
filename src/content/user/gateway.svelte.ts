/**
 * Gateway модуля пользователя — подключение приложения (SvelteKit): собирает порты из существующих
 * хвостов проекта и переводит голые результаты в HTTP. Файл — скелет связки:
 * тела пустые, каждое место помечено, ЧТО сюда подключается. В routes не
 * импортируется никем — каркас оценивается чтением, не прогоном.
 *
 * Ключевое свойство: `auth(event)` один и тот же для REST (`+server.ts`) и
 * POST (`+page.server.ts`) — у обоих есть `event.cookies` и тело запроса.
 */
import type { AuthPorts } from './ports.js'
import type { UserResult } from './user.js'
import type { Principal } from './types.js'

/** Структурный срез SvelteKit-события: куки + тело — этого ядру достаточно. */
export interface AuthEvent {
  cookies: {
    get(name: string): string | undefined
    set(name: string, value: string, opts: { path: string; maxAge: number; httpOnly: boolean; secure: boolean; sameSite: 'lax' }): void
    delete(name: string, opts: { path: string }): void
  }
  /** Хеш подсети считает сервер по `request.headers`; сам IP не выходит из хеша. */
  subnetHash(): string | undefined
}

/**
 * Порты из хвостов проекта:
 *
 *  - `challenge`/`sessions`/`blacklist` → `#lib/cache` `Store`, область 'auth'
 *    (прецедент: 'fields-demo'); для сессий, пишущих в БД, — Postgres-хранилище
 *    из README `lib/cache` §6 в транзакции данных;
 *  - `identities` → ресурс `defineResource` (`demo.identity`: pubkey, createdAt,
 *    tokenVersion; ключи доступа — README `lib/db` §7; создание — все ключи);
 *  - `keys` → `src/env.ts` (`defineEnvVars`): `AUTH_SIGNING_SECRET` +
 *    `AUTH_SIGNING_OLD_SECRETS`, ротация по схеме `DB_CURSOR_KID`/`…_OLD_KEYS`;
 *  - `tokens` → WebCrypto HS256 (или JWS-библиотека — решение при реализации);
 *  - `crypto` → проверка подписи nonce публичным ключом (алгоритм — выбор
 *    при реализации: ed25519 не в WebCrypto — возможно, @noble/ed25519);
 *  - `clock`/`network` → серверное время; хеш подсети — по заголовкам запроса;
 *  - `config` → `src/env.ts`.
 */
export function authPorts(event: AuthEvent): AuthPorts {
  void event
  throw skeleton('authPorts')
}

/**
 * Фасад одного запроса: голые функции ядра с уже подставленными портами и
 * куки. Этот объект берут и `+server.ts`, и экшен:
 *
 *   const auth = auth(event)
 *   const result = await auth.verify()        // каждый запрос
 *   const result = await auth.login(args)     // шаг входа
 */
export function auth(event: AuthEvent): {
  verify(): Promise<UserResult<Principal>>
  login(args: { pubkey: string; nonce: string; signature: string }): Promise<UserResult<Principal>>
  renew(): Promise<UserResult<Principal>>
  logout(): Promise<UserResult<null>>
  logoutEverywhere(): Promise<UserResult<null>>
  listSessions(): Promise<UserResult<import('./types.js').SessionView[]>>
  deleteIdentity(): Promise<UserResult<null>>
} {
  void event
  throw skeleton('auth')
}

/**
 * Principal для `dbHandle` (`hooks.server.ts`): замена `DEMO_PRINCIPAL`.
 *
 *   principal: async () => principalOf(await auth(event).verify())
 *
 * Гость → `undefined`: права решают ключи доступа (README `lib/db` §7), у
 * гостя их нет. В `hooks.server.ts` ничего не меняется, пока каркас не внедрён.
 */
export function principalOf(result: UserResult<Principal>): Principal | undefined {
  void result
  throw skeleton('principalOf')
}

/**
 * Перевод результата в HTTP — одинаково для `Response` REST-маршрута и
 * `fail/redirect` экшена (тексты кодов выбирает владелец, каркас несёт коды).
 */
export function toHttpStatus(result: UserResult<unknown>): number {
  void result
  throw skeleton('toHttpStatus')
}

function skeleton(fn: string): Error {
  return new Error(`каркас авторизации: ${fn} не реализован (план: docs/design/auth-seed.md §5)`)
}
