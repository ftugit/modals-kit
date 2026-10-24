// Сбой базы — в язык показа формы (`origin: 'server'` с путём поля), а не в
// текст фреймворка и не в 500 на всю страницу. Приём живёт в
// `db.form.server.ts`: эти тексты нужны всем трём регистрациям.
import { failureIssues } from '#lib/db/index.js'
import { toFormFailure } from '#lib/db/sveltekit/index.js'
import type { FormError, IssueLike } from '#lib/form/index.js'

/**
 * Общие тексты видов сбоя для человека: `lib/db` отдаёт свои (английские,
 * без подробностей), приложение показывает их по-русски. Подробности — только в
 * dev-диагностике (`toFormFailure`, DB-2).
 */
const KIND_TEXT: Record<string, string> = {
  conflict: 'Такая запись уже есть',
  forbidden: 'Недостаточно прав',
  not_found: 'Запись не найдена',
  unavailable: 'База данных недоступна. Попробуйте позже',
  database: 'Не удалось выполнить запрос к базе данных',
  transaction: 'Запись прервана. Попробуйте ещё раз',
  schema_pending: 'База данных обновляется. Попробуйте позже',
}
/** Текст общего сбоя: в production — по виду сбоя, в dev — как есть (подробности). */
const kindText = (code: string, message: string, generic: string) =>
  !import.meta.env.DEV && message === generic && KIND_TEXT[code] ? KIND_TEXT[code] : message

/**
 * Сбой базы — в тот же язык показа, что и ошибки валидации: `origin: 'server'`
 * с путём поля, а не текст фреймворка и не 500 на всю страницу.
 */
function toFormErrors(e: unknown): FormError[] {
  const { data } = toFormFailure(e, import.meta.env.DEV)
  const out: FormError[] = []
  for (const [path, texts] of Object.entries(data.fieldErrors))
    texts.forEach((message, i) =>
      out.push({ id: `${path}:${data.code}:${i}`, code: data.code, message, path, origin: 'server' }))
  data.formErrors.forEach((message, i) =>
    out.push({ id: `*:${data.code}:${i}`, code: data.code, message: kindText(data.code, message, data.message), origin: 'server' }))
  if (!out.length)
    out.push({
      id: '*:db:0', code: data.code || 'db.rejected',
      message: KIND_TEXT[data.code] ?? (data.message || 'база отклонила запрос'), origin: 'server',
    })
  return out
}

/**
 * Отказ слоя БД в язык показа формы: сначала issues самой БД (у них есть `path`
 * и шаблон текста), иначе — общая ошибка с текстом по виду сбоя.
 */
export const failureIssuesOf = (e: unknown): readonly FormError[] | readonly IssueLike[] =>
  failureIssues(e) ?? toFormErrors(e)
