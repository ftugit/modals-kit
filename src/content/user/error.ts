/**
 * Инструкции ошибок модуля пользователя — перевод голого факта API в ошибки
 * формы. Ядро (`user.ts`) не знает про валидаторы и `lib/form`: возвращает
 * `{ code, path?, args? }` — «юзера не существует» это доменный факт.
 *
 * Инструкция знает, КАК факт показывается: какой путь у формы, какой код
 * уходит в `ctx.fail`, какие параметры подстановки. РЕАЛЬНАЯ инструкция
 * появится при внедрении; сейчас — реестр кодов с заготовками и эмуляция
 * (`demoInstruction`) для проверки цепочки.
 *
 * Формат ошибки — `FormError` из `lib/form` (код + путь + params, id считает
 * форма): `ctx.fail(toFormErrors(instruction(fact)))` — и форма показит текст
 * у пути. Тексты кодов выбирает владелец: словарь по умолчанию — в UI.
 */
import type { FormError } from '#lib/form/result.js'

/** Доменные коды модуля пользователя. */
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
  | 'auth.blocked'            // аккаунт заблокирован (объект blocked)
  | 'auth.delete-pending'     // заявка на удаление: вход ведёт на шаг восстановления
  | 'auth.confirm'            // подтверждение не прошло (удаление аккаунта)

/** Голый факт из API: доменный код без знания о форме. */
export type AuthFact = {
  code: AuthErrorCode
  /** Имя поля формы, если ошибка у поля; нет — общая. */
  path?: string
  args?: Record<string, string | number>
}

/** Инструкция: факт → список ошибок формы (проводка `ctx.fail`). */
export type AuthInstruction = (fact: AuthFact) => readonly FormError[]

/**
 * Реестр инструкций — код → проводка. Наполнится при внедрении; сейчас —
 * общий случай: путь из факта, подстановки из аргументов.
 */
const INSTRUCTIONS: Record<AuthErrorCode, AuthInstruction> = {
  'auth.nonce-unknown': (f) => [fieldError(f, { path: 'signature', retryable: true })],
  'auth.signature': (f) => [fieldError(f, { path: 'signature' })],
  'auth.identity-unknown': (f) => [fieldError(f, { path: 'seed' })],
  'auth.token': () => [generalError('auth.token')],
  'auth.kid-unknown': () => [generalError('auth.kid-unknown', { retryable: true })],
  'auth.expired': () => [generalError('auth.expired')],
  'auth.revoked': () => [generalError('auth.revoked')],
  'auth.session-unknown': () => [generalError('auth.session-unknown')],
  'auth.version': () => [generalError('auth.version')],
  'auth.blocked': () => [generalError('auth.blocked')],
  'auth.delete-pending': () => [generalError('auth.delete-pending')],
  'auth.confirm': (f) => [fieldError(f)],
}

/** Ошибка поля: путь обязателен — из факта или из инструкции. */
function fieldError(fact: AuthFact, fixed?: { path?: string; retryable?: boolean }): FormError {
  const path = fixed?.path ?? fact.path
  if (!path) throw new Error(`инструкция ${fact.code}: нет пути (факт без пути)`)
  return error(fact, path, fixed?.retryable)
}

/** Общая ошибка: без пути — баннер над формой. */
function generalError(code: AuthErrorCode, opts?: { retryable?: boolean }): FormError {
  return { id: '', code, origin: 'external', retryable: opts?.retryable }
}

function error(fact: AuthFact, path: string, retryable?: boolean): FormError {
  return {
    id: '',
    code: fact.code,
    origin: 'external',
    path,
    params: fact.args,
    ...(retryable ? { retryable: true } : {}),
  }
}

/** Проводка по умолчанию: реестр с откатом к общему случаю. */
export const instruction: AuthInstruction = (fact) =>
  (INSTRUCTIONS[fact.code] ?? ((f) => [fieldError(f, { path: f.path ?? '' })]))(fact)

/**
 * Список фактов → ошибки формы. Вызов в экшене:
 *
 *   const r = await user.login(ports, args)
 *   if (!r.ok) ctx.fail(toFormErrors(instruction(r.error)))
 */
export const toFormErrors = (facts: readonly AuthFact[]): readonly FormError[] =>
  facts.flatMap(instruction)

/** Эмуляция для проверки цепочки (ход 251): факты, как их отдаст API. */
export const demoFacts = (): readonly AuthFact[] => [
  { code: 'auth.identity-unknown' },                       // API не знает путей
  { code: 'auth.signature' },
  { code: 'auth.blocked' },
]
