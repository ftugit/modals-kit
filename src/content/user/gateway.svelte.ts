/**
 * Gateway модуля пользователя — подключение приложения (SvelteKit): собирает
 * порты из хвостов проекта и переводит голые результаты в HTTP. Скелет
 * связки: тела пустые, помечено, ЧТО подключается. В routes не импортируется
 * никем — каркас оценивается чтением, не прогоном.
 *
 * ОБЩЕГО ВЫЗОВА НА ПРИЛОЖЕНИЕ НЕТ (решение владельца): никаких автопроверок в
 * hooks на каждый запрос. Каждый компонент обращается к api сам — через фасад
 * `auth(event)` или функции из `auth.ts`.
 */
import type { UserConfig } from './config.js'
import type { UserResult } from './auth.js'
import type { AuthPorts } from './ports.js'
import type { ProfileView } from './types.js'

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
 *  - `sessions`/`challenge` → `#lib/cache` `Store` (`localStore`), область
 *    'user-auth'; когда сессии лягут в БД — ресурс `user_session` (адаптер
 *    решает, ядро не меняется);
 *  - `auths`/`profiles` → ресурсы `schema.ts` через `lib/db`;
 *  - `sealKeys` → `src/env.ts`: `AUTH_SEAL_ID` + `AUTH_SEAL_KEYS` (карта
 *    id → секрет, ротация как у курсорных);
 *  - `seal` → iron-webcrypto (изоморфно; AEAD-подмодуль в релизе отсутствует —
 *    формат CBC+HMAC);
 *  - `crypto` → `keys.ts`, УЖЕ РЕАЛЬНО: `@noble/ed25519`;
 *  - `cookies`/`clock` → `event.cookies`; время — серверное;
 *  - `config` → `createUserConfig(localStore)` из `config.ts`.
 */
export function authPorts(event: AuthEvent): AuthPorts & { config: UserConfig } {
  void event
  throw skeleton('authPorts')
}

/**
 * Фасад одного запроса: голые функции ядра с подставленными портами и куками.
 * Компонент (роут/форма) вызывает только то, что ему нужно:
 *
 *   const u = auth(event)
 *   const r = await u.login({ seed, nonce, signature })
 */
export function auth(event: AuthEvent): {
  issueChallenge(): Promise<UserResult<import('./types.js').Challenge>>
  login(args: { seed: string; nonce: string; signature: string; deviceName?: string }): Promise<UserResult<import('./types.js').Principal>>
  renew(): Promise<UserResult<import('./types.js').Principal>>
  logout(): Promise<UserResult<null>>
  logoutAll(): Promise<UserResult<null>>
  listSessions(): Promise<UserResult<import('./auth.js').SessionView[]>>
  revokeSession(jti: string): Promise<UserResult<null>>
  profile(): Promise<UserResult<ProfileView>>
  updateProfile(args: { nickname?: string; avatarUrl?: string | null }): Promise<UserResult<ProfileView>>
  requestDelete(): Promise<UserResult<null>>
  cancelDelete(): Promise<UserResult<import('./types.js').Principal>>
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
  return new Error(`каркас gateway: ${fn} не реализован (план: docs/design/auth-seed.md)`)
}
