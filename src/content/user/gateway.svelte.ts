/**
 * Gateway модуля пользователя — подключение приложения (SvelteKit): собирает
 * порты из хвостов проекта и переводит голые результаты в HTTP. Скелет
 * связки: тела пустые, помечено, ЧТО подключается. В routes не импортируется
 * никем — каркас оценивается чтением, не прогоном.
 *
 * Ключевое: на каждый запрос верификации хранилищем НЕТ. Principal для
 * `dbHandle` извлекается из access-куки без похода в хранилище (подпись +
 * exp, stateless); бан догоняет юзера в точке продления (`renew` — фаервол).
 */
import type { UserResult } from './auth.js'
import type { AuthPorts } from './ports.js'
import type { Principal, ProfileView } from './types.js'

/** Структурный срез SvelteKit-события: куки — этого ядру достаточно. */
export interface AuthEvent {
  cookies: {
    get(name: string): string | undefined
    set(name: string, value: string, opts: { path: string; maxAge: number; httpOnly: boolean; secure: boolean; sameSite: 'lax' }): void
    delete(name: string, opts: { path: string }): void
  }
}

/**
 * Порты из хвостов проекта:
 *
 *  - `renewals` (записи продления, баны, nonce, активность) → `#lib/cache`
 *    `Store`, область 'auth' (прецедент: 'fields-demo'); для записи в базу —
 *    Postgres-хранилище из README `lib/cache` §6;
 *  - `auths`/`profiles` → ресурсы `schema.ts` через `lib/db` (ключи доступа —
 *    README `lib/db` §7); «двойной select» фаервола — в адаптере `auths.get`;
 *  - `keys` → `src/env.ts` (`defineEnvVars`): `AUTH_SIGNING_SECRET` +
 *    `AUTH_SIGNING_OLD_SECRETS`, ротация по схеме `DB_CURSOR_KID`/`…_OLD_KEYS`;
 *  - `tokens` → WebCrypto HS256 (или JWS-библиотека — решение при реализации);
 *  - `crypto` → `keys.ts`, УЖЕ РЕАЛЬНО: `@noble/ed25519`, изоморфно —
 *    генерация связки и подписание у клиента с JS идут тем же файлом;
 *  - `cookies`/`clock` → `event.cookies`; время — серверное.
 */
export function authPorts(event: AuthEvent): AuthPorts {
  void event
  throw skeleton('authPorts')
}

/**
 * Principal для `dbHandle` (`hooks.server.ts`) — БЕЗ верификации хранилищем:
 * подпись + exp из access-куки (stateless); гость → `undefined`. Отзыв и
 * блокировка догоняют юзера в точке продления — так решил владелец (ход 251).
 */
export function principalOf(event: AuthEvent): Promise<Principal | undefined> {
  void event
  throw skeleton('principalOf')
}

/**
 * Фасад одного запроса: голые функции ядра с подставленными портами и куками.
 * Этот объект берут и `+server.ts`, и экшен:
 *
 *   const auth = auth(event)
 *   const result = await auth.renew()       // фаервол, по таймеру приложения
 */
export function auth(event: AuthEvent): {
  login(args: { seed: string; nonce: string; signature: string }): Promise<UserResult<Principal>>
  renew(): Promise<UserResult<Principal>>
  logout(): Promise<UserResult<null>>
  logoutEverywhere(): Promise<UserResult<null>>
  profile(): Promise<UserResult<ProfileView>>
  updateProfile(args: { nickname?: string; avatarUrl?: string | null }): Promise<UserResult<ProfileView>>
  deleteIdentity(): Promise<UserResult<null>>
} {
  void event
  throw skeleton('auth')
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
  return new Error(`каркас gateway: ${fn} не реализован (план: docs/design/auth-seed.md §5)`)
}
