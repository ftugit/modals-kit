/**
 * API пользователя — голые функции над портами. Один и тот же вызов годится
 * для REST (`+server.ts`) и POST-экшена (`+page.server.ts`): голые аргументы
 * → голый `AuthResult` (данные или { код, путь }), перевод — в gateway.
 *
 * Тела пустые (`каркас`): оценивается цепочка вызова и покрытие правил
 * статьи об отзыве JWT (помечено «статья: N»), план — docs/design/auth-seed.md.
 * Схемы и поля форм — `schema.ts`; коды ошибок и проводка в форму — `error.ts`.
 */
import type { AuthPorts } from './ports.js'
import type {
  AccessTokenClaims,
  Challenge,
  KeyView,
  Principal,
  ProfileView,
  RevocationEntry,
  SessionView,
} from './types.js'
import type { AuthFact } from './error.js'

/**
 * Результат функции API: данные или голый факт (код + путь без знания о
 * форме). Перевод факта в ошибки формы — инструкция (`error.ts`), в HTTP —
 * gateway; ядро не знает ни валидаторов, ни ответов.
 */
export type UserResult<T> =
  | { ok: true; value: T }
  | { ok: false; fact: AuthFact }

/** Срок жизни access — 15 минут (статья: 2, короткий exp). */
export const ACCESS_TTL_SEC = 15 * 60
/** Одноразовый challenge живёт две минуты. */
export const CHALLENGE_TTL_SEC = 120
/** Имя куки-носителя: HttpOnly, Secure, SameSite=Lax (практики статьи). */
export const COOKIE_NAME = 'auth_sid'

/* ── вход (auth) ───────────────────────────────────────────────────── */

/** Шаг 1 входа: одноразовый nonce на подпись. */
export async function issueChallenge(ports: AuthPorts): Promise<UserResult<Challenge>> {
  void ports
  throw skeleton('issueChallenge')
}

/**
 * Шаг 2 входа: nonce потрачен, подпись сошлась, identity найден/создан,
 * сессия-бронь открыта, access в куки (адаптер). Статья: 2 (короткий exp).
 */
export async function login(
  ports: AuthPorts,
  args: { pubkey: string; nonce: string; signature: string },
): Promise<UserResult<Principal>> {
  void ports
  void args
  throw skeleton('login')
}

/** Регистрация: identity создаётся явно, до входа (гость становится юзером). */
export async function register(
  ports: AuthPorts,
  args: { pubkey: string },
): Promise<UserResult<Principal>> {
  void ports
  void args
  throw skeleton('register')
}

/* ── каждый запрос ─────────────────────────────────────────────────── */

/**
 * Вся статья в одном месте: exp (2), чёрный список jti (1), бронь сессии (5),
 * tokenVersion (4), счётчик подсетей (практики), kid после ротации (3).
 * Результат — principal для `dbHandle` (гость — без principal).
 */
export async function verify(ports: AuthPorts): Promise<UserResult<Principal>> {
  void ports
  throw skeleton('verify')
}

/* ── жизнь сессии ──────────────────────────────────────────────────── */

/** Продление: новый jti, старый гасится сразу (статья: 7, без окна уязвимости). */
export async function renew(ports: AuthPorts): Promise<UserResult<Principal>> {
  void ports
  throw skeleton('renew')
}

/** Выход: бронь удалена, jti в чёрном списке до конца exp (статья: 5). */
export async function logout(ports: AuthPorts): Promise<UserResult<null>> {
  void ports
  throw skeleton('logout')
}

/** Выйти со всех устройств: tokenVersion += 1 (статья: 4). */
export async function logoutEverywhere(ports: AuthPorts): Promise<UserResult<null>> {
  void ports
  throw skeleton('logoutEverywhere')
}

/** Погасить одну сессию по jti (статья: 1, гранулярность). */
export async function revokeSession(ports: AuthPorts, jti: string): Promise<UserResult<null>> {
  void ports
  void jti
  throw skeleton('revokeSession')
}

/** Активные сессии (открытый вопрос владельца: список устройств). */
export async function listSessions(ports: AuthPorts): Promise<UserResult<SessionView[]>> {
  void ports
  throw skeleton('listSessions')
}

/* ── профиль (user) ────────────────────────────────────────────────── */

/** Свой профиль: псевдоним (id/createdAt) без личных данных (приватность §4). */
export async function profile(ports: AuthPorts): Promise<UserResult<ProfileView>> {
  void ports
  throw skeleton('profile')
}

/** Доступ юзера к другим модулям (права решают ключи доступа lib/db §7). */
export async function access(ports: AuthPorts): Promise<UserResult<{ roles: readonly string[] }>> {
  void ports
  throw skeleton('access')
}

/** Сменить связку ключей: старая подпись подтверждает, новая привязывается. */
export async function rotateKeys(
  ports: AuthPorts,
  args: { nextPubkey: string; signature: string },
): Promise<UserResult<null>> {
  void ports
  void args
  throw skeleton('rotateKeys')
}

/* ── ключи и сервисы (обслуживание) ────────────────────────────────── */

/** Ротация секрета подписи (статья: 3); массовый отзыв — с tokenVersion. */
export async function rotateSigningKey(
  ports: AuthPorts,
  next: { kid: string; secret: string },
): Promise<UserResult<KeyView>> {
  void ports
  void next
  throw skeleton('rotateSigningKey')
}

/** Снимок чёрного списка для чужого сервиса (статья: 6, TRL-стык). */
export async function revocationSnapshot(ports: AuthPorts): Promise<UserResult<RevocationEntry[]>> {
  void ports
  throw skeleton('revocationSnapshot')
}

/** Отметить активность для счётчика аномалий (IP не хранится). */
export async function noteActivity(ports: AuthPorts, principal: Principal): Promise<UserResult<null>> {
  void ports
  void principal
  throw skeleton('noteActivity')
}

/* ── приватность ───────────────────────────────────────────────────── */

/** Удалить identity: строка-псевдоним стирается, сессии гасятся, право на удаление исполнено. */
export async function deleteIdentity(ports: AuthPorts): Promise<UserResult<null>> {
  void ports
  throw skeleton('deleteIdentity')
}

/* ── служебное ─────────────────────────────────────────────────────── */

/** Клеймы текущего токена — для отладки цепочки (не для клиента). */
export type DebugClaims = AccessTokenClaims

function skeleton(fn: string): Error {
  return new Error(`каркас модуля user: ${fn} не реализован (план: docs/design/auth-seed.md §5)`)
}
