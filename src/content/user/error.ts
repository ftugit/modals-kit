/**
 * Ошибки модуля пользователя — контракт с формой и REST.
 *
 * Формат — тот же, что понимает `lib/form` (код + путь + причины), поэтому
 * `AuthError` ложится в `ctx.fail` как есть, а REST переводит коды в статусы
 * таблицей ниже. Ядро API валидаторов не знает: голый `AuthResult` (см.
 * `types.ts`) несёт только код — «юзера не существует» это доменный факт,
 * а не проверка формы.
 *
 * Тексты кодов выбирает владелец: словарь по умолчанию — в UI (gateway),
 * как у всех ошибок `lib/form` (`ru`-тексты рядом с потребителем).
 */

/** Доменная ошибка модуля пользователя: код + путь (куда показывать). */
export type AuthErrorCode =
  | 'auth.nonce-unknown'      // challenge истёк или уже потрачен
  | 'auth.signature'          // подпись nonce не сошлась
  | 'auth.identity-unknown'   // юзера не существует (удалён)
  | 'auth.token'              // токен не читается / подпись чужая
  | 'auth.kid-unknown'        // подписан неизвестным ключом (после ротации)
  | 'auth.expired'            // access истёк
  | 'auth.revoked'            // jti в чёрном списке
  | 'auth.session-unknown'    // брони сессии нет (выход, отзыв)
  | 'auth.version'            // tokenVersion не совпал («выйти со всех»)
  | 'auth.anomaly'            // счётчик подсетей превысил порог
  | 'auth.identity-exists'    // вход новым ключом, а identity уже есть (регистрация повторно)
  | 'auth.confirm'            // подтверждение не прошло (удаление аккаунта и т.п.)

/** Путь ошибки: имя поля формы или общий (баннер над формой). */
export type AuthErrorPath = string // 'pubkey' | 'signature' | '' — общий

/** Ошибка в проводке `lib/form`: код + путь + опциональные причины. */
export type AuthError = {
  code: AuthErrorCode
  path: AuthErrorPath
  /** Аргументы текста (не строки): количество, имя шага — выбирает словарь UI. */
  args?: Record<string, string | number>
}

/**
 * Инструкция для `lib/form`: `ctx.fail(...)` принимает список таких фактов
 * (прецедент — серверные ошибки полей `lib/form`), форма показит текст у пути.
 * `AuthError` уже в этой форме — отдельная инструкция не нужна.
 */
export const authInstruction = (error: AuthError) => [error] // форма принимает список

/**
 * Код → HTTP-статус для REST (`+server.ts`). Форма об этом не знает:
 * для POST-экшена статус выбирает `fail(422)`.
 */
export const AUTH_STATUS: Record<AuthErrorCode, number> = {
  'auth.nonce-unknown': 422,
  'auth.signature': 401,
  'auth.identity-unknown': 404,
  'auth.token': 401,
  'auth.kid-unknown': 401,
  'auth.expired': 401,
  'auth.revoked': 401,
  'auth.session-unknown': 401,
  'auth.version': 401,
  'auth.anomaly': 403,
  'auth.identity-exists': 409,
  'auth.confirm': 422,
}
