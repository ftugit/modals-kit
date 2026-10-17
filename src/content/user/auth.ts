/**
 * API модуля пользователя — голые функции над портами. Ни Request/Response,
 * ни валидаторов: на входе голые данные, на выходе данные или голый факт
 * (код+путь); перевод в HTTP делает gateway, в ошибки формы — инструкции
 * `error.ts`.
 *
 * Модель (решения владельца, ход 251):
 *  - вход единый, без отдельной регистрации: seed не найден → аккаунт
 *    создаётся (auth + пустой профиль). Связку ключей генерирует приложение
 *    отдельно (`keys.ts`; у юзера с JS — в браузере), login ждёт конечный
 *    публичный ключ (seed) и подпись nonce;
 *  - access-токен короткий и БЕЗ jti: не хранится, забанить его нельзя;
 *  - верификации на каждом запросе нет: бан проверяет точка продления
 *    («фаервол приложения») — двойное чтение в один момент: бан jti +
 *    строка auth (версия, блокировка, удаление). Юзер выкидывается, когда
 *    приложение продлевает сессию или читает таблицу auth;
 *  - токен продления одноразовый: при использовании блокируется до конца
 *    срока (повтор = сигнал кражи — гасим сессию целиком; уточнение гайда,
 *    способ 7);
 *  - аккаунт целиком не удаляется: заявка → сессии мертвы сразу, вход
 *    закрыт; через n дней исполнитель удаляет профиль и стирает seed/
 *    security — строка auth остаётся надгробием (id и времена).
 */
import type { AuthFact } from './error.js'
import type { AuthPorts } from './ports.js'
import type { Challenge, Principal, ProfileView } from './types.js'

/** Результат функции API: данные или голый факт (код+путь). */
export type UserResult<T> =
  | { ok: true; value: T }
  | { ok: false; fact: AuthFact }

/** Короткий access — гайд, способ 2: риск кражи ограничен остатком срока. */
export const ACCESS_TTL_SEC = 900 // 15 минут
/** Токен продления: на одну авторизацию; ротация при каждом продлении. */
export const RENEWAL_TTL_SEC = 60 * 60 * 24 * 30
/** Одноразовый nonce на подпись. */
export const CHALLENGE_TTL_SEC = 120
/** Куки access-токена. */
export const COOKIE_NAME = 'auth_sid'
/** Куки токена продления (раздельно с access — разные сроки и судьбы). */
export const RENEWAL_COOKIE_NAME = 'auth_renew'
/** Грейс удаления, дней. Заглушка — n решает владелец. */
export const DELETE_GRACE_DAYS = 30

/** Шаг 1 входа: одноразовый nonce на подпись. */
export async function issueChallenge(ports: AuthPorts): Promise<UserResult<Challenge>> {
  void ports
  throw skeleton('issueChallenge')
}

/**
 * Единый вход=регистрация: seed не найден → создаём auth + пустой профиль.
 * Подпись nonce проверяется публичным (seed) — `ports.crypto.verify`.
 * Закрытые двери до входа: объект блокировки (`auth.blocked`) и
 * незавершённое удаление (`auth.delete-pending`).
 */
export async function login(
  ports: AuthPorts,
  args: { seed: string; nonce: string; signature: string },
): Promise<UserResult<Principal>> {
  void ports
  void args
  throw skeleton('login')
}

/**
 * Фаервол приложения — единственное место проверки бана. Двойное чтение в
 * один момент: бан jti (`renewals.get`) + строка auth (`auths.get`: версия,
 * блокировка, метка удаления). Успех: предъявленный токен продления
 * блокируется (одноразовость), выдаются новые access + продление. Отказ —
 * кик: куки сняты, факт `revoked`/`blocked`/`session-unknown`/`version`/
 * `delete-pending`.
 */
export async function renew(ports: AuthPorts): Promise<UserResult<Principal>> {
  void ports
  throw skeleton('renew')
}

/** Выход: токен продления блокируется до конца срока (ловля повтора — кража). */
export async function logout(ports: AuthPorts): Promise<UserResult<null>> {
  void ports
  throw skeleton('logout')
}

/** Выйти со всех устройств: tokenVersion += 1 — все продления мертвы у фаервола. */
export async function logoutEverywhere(ports: AuthPorts): Promise<UserResult<null>> {
  void ports
  throw skeleton('logoutEverywhere')
}

/** Свой профиль: никнейм и адрес аватара, других данных нет (приватность §4). */
export async function profile(ports: AuthPorts): Promise<UserResult<ProfileView>> {
  void ports
  throw skeleton('profile')
}

/** Сохранить свой профиль: правила полей — `schema.ts` (никнейм, адрес аватара). */
export async function updateProfile(
  ports: AuthPorts,
  args: { nickname?: string; avatarUrl?: string | null },
): Promise<UserResult<ProfileView>> {
  void ports
  void args
  throw skeleton('updateProfile')
}

/**
 * Заявка на удаление аккаунта: сессии мертвы сразу (`revokeAllByIdentity` +
 * куки), вход закрыт до конца грейса. Через n дней исполнитель зачистит
 * данные — сам вайп не здесь, а у планировщика (`sweepDeletions`).
 */
export async function deleteIdentity(ports: AuthPorts): Promise<UserResult<null>> {
  void ports
  throw skeleton('deleteIdentity')
}

/**
 * Исполнитель удаления (зовёт планировщик приложения по расписанию):
 * профиль — удалить, auth — стереть seed и security (надгробие остаётся).
 * Возвращает число зачищенных аккаунтов.
 */
export async function sweepDeletions(ports: AuthPorts): Promise<UserResult<number>> {
  void ports
  throw skeleton('sweepDeletions')
}

function skeleton(fn: string): Error {
  return new Error(`каркас auth: ${fn} не реализован (план: docs/design/auth-seed.md §5)`)
}
