/**
 * API модуля пользователя — голые функции над портами. Ни Request/Response,
 * ни валидаторов: на входе голые данные, на выходе данные или голый факт
 * (код+путь); перевод в HTTP делает gateway, в ошибки формы — инструкции
 * `error.ts`.
 *
 * ФАЕРВОЛ живёт здесь: функции, которым он нужен, вызывают `guard()` сами
 * (правка профиля — да, генерация связки — нет). Общего вызова на приложение
 * НЕТ: каждый компонент обращается к api сам.
 *
 * Модель (решения владельца, ход 251):
 *  - вход единый: seed не найден → аккаунт создаётся (auth + вход);
 *  - временный токен — запечатанная строка (iron-webcrypto), сервер её не
 *    хранит; девайс-токен — строка сессии в БД;
 *  - отзыв = софт-удаление строки сессии; статусы фаервола:
 *    ok / revoked / expired / unknown;
 *  - заявка на удаление НЕ закрывает вход: вход ведёт на шаг восстановления
 *    (steps) «аккаунт ещё живой»; отменил — метка снята и происходит вход;
 *  - сроки и поведение — из конфига модуля (`config.ts`), не константы.
 */
import type { AuthFact } from './error.js'
import type { AuthPorts } from './ports.js'
import type { Challenge, Principal, ProfileView, SessionStatus } from './types.js'

/** Результат функции API: данные или голый факт (код+путь). */
export type UserResult<T> =
  | { ok: true; value: T }
  | { ok: false; fact: AuthFact }

/** Шаг 1 входа: одноразовый nonce на подпись (срок — из конфига challenge). */
export async function issueChallenge(ports: AuthPorts): Promise<UserResult<Challenge>> {
  void ports
  throw skeleton('issueChallenge')
}

/**
 * Единый вход: подпись nonce по seed; аккаунта нет — создаём (auth + соль
 * подсетей). Блокировка сферой 'auth' → `auth.blocked`. Аккаунт с заявкой на
 * удаление → факт `auth.delete-pending`: НЕ сессия, а направление на шаг
 * восстановления; отмена заявки там же (`cancelDelete`).
 */
export async function login(
  ports: AuthPorts,
  args: { seed: string; nonce: string; signature: string; deviceName?: string },
): Promise<UserResult<Principal>> {
  void ports
  void args
  throw skeleton('login')
}

/**
 * Продление (фаервол): guard по девайс-токену — статус сессии (ok / revoked /
 * expired / unknown), блокировки аккаунта, заявка на удаление. Режим
 * `sessionRecreate` из конфига: 'strict' — смена подсети запрещает
 * пересоздание; 'update' — сведения обновляются, прежние в историю. Успех:
 * старый токен продления гасится, новый создаётся, временный — свежая
 * запечатанная строка.
 */
export async function renew(ports: AuthPorts): Promise<UserResult<Principal>> {
  void ports
  throw skeleton('renew')
}

/** Выход: софт-удаление своей сессии + снятие кук (адаптер). */
export async function logout(ports: AuthPorts): Promise<UserResult<null>> {
  void ports
  throw skeleton('logout')
}

/** Выйти со всех устройств: софт-удаление всех строк сессий аккаунта. */
export async function logoutAll(ports: AuthPorts): Promise<UserResult<null>> {
  void ports
  throw skeleton('logoutAll')
}

/** Список устройств: имя, времена, текущая подсеть (хэш) и история. */
export async function listSessions(ports: AuthPorts): Promise<UserResult<SessionView[]>> {
  void ports
  throw skeleton('listSessions')
}

/** Отозвать устройство по jti (софт-удаление его строки сессии). */
export async function revokeSession(ports: AuthPorts, jti: string): Promise<UserResult<null>> {
  void ports
  void jti
  throw skeleton('revokeSession')
}

/** Свой профиль: есть строка — её значения; нет — аноним (нулевые). */
export async function profile(ports: AuthPorts): Promise<UserResult<ProfileView>> {
  void ports
  throw skeleton('profile')
}

/**
 * Сохранить профиль. ПЕРВОЕ заполнение создаёт строку профиля. Фаервол нужен:
 * вызов идёт через guard. Никнейм проверяется на список запрещённых
 * (config.nicknameForbidden); правила полей — `schema.ts`.
 */
export async function updateProfile(
  ports: AuthPorts,
  args: { nickname?: string; avatarUrl?: string | null },
): Promise<UserResult<ProfileView>> {
  void ports
  void args
  throw skeleton('updateProfile')
}

/** Заявка на удаление: софт-метка; вход теперь ведёт на шаг восстановления. */
export async function requestDelete(ports: AuthPorts): Promise<UserResult<null>> {
  void ports
  throw skeleton('requestDelete')
}

/**
 * Отмена заявки (шаг восстановления): метка снята — и происходит обычный вход
 * (сессия живёт). Доказательство владения — та же подпись, что у входа.
 */
export async function cancelDelete(ports: AuthPorts): Promise<UserResult<Principal>> {
  void ports
  throw skeleton('cancelDelete')
}

/**
 * Исполнитель удаления (зовёт планировщик приложения): профиль уходит
 * (цепочка), seed/security стираются — надгробие остаётся. Возвращает число
 * зачищенных аккаунтов.
 */
export async function sweepDeletions(ports: AuthPorts): Promise<UserResult<number>> {
  void ports
  throw skeleton('sweepDeletions')
}

/** Вид сессии для списка устройств (хэш подсети, не адрес). */
export type SessionView = {
  jti: string
  deviceName: string | null
  subnetHash: string | null
  country: string | null
  history: import('./types.js').SubnetEntry[]
  createdAt: number
  expiresAt: number
  lastSeenAt: number | null
}

/** Статус сессии — вычисляет фаервол из записи (эмуляция session-status). */
export function statusOf(record: import('./types.js').SessionRecord | undefined, now: number): SessionStatus {
  if (!record) return 'unknown'
  if (record.deletedAt !== null) return 'revoked'
  if (record.expiresAt <= now) return 'expired'
  return 'ok'
}

/** Скелет: тело появится при внедрении (план — auth-seed.md §5–6). */
function skeleton(fn: string): Error {
  return new Error(`каркас auth: ${fn} не реализован (план: docs/design/auth-seed.md)`)
}
