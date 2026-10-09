// Серверная половина демо БД: приём идёт через слои lib/form — метод, origin,
// лимит тела, проверка имён, потом валидация и execute. Маршрут обязан
// остаться тонким: собственный `request.formData()` в маршруте layer-guard
// роняет сборку именно потому, что он выбрасывает всё перечисленное молча.
import type { Database, DataContext } from '$lib/db'
import { toFormFailure } from '$lib/db/sveltekit'
import { createFormHandler, type Handled } from '$lib/form/server'
import type { FormError } from '$lib/form'
import { getRuntime, posts } from '$lib/server/db'
import { SECURITY_LAYERS } from '$lib/server/form-security'
import { dbCreate, dbRemove } from './description'

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
    out.push({ id: `*:${data.code}:${i}`, code: data.code, message, origin: 'server' }))
  if (!out.length)
    out.push({
      id: '*:db:0', code: data.code || 'db.rejected',
      message: data.message || 'база отклонила запрос', origin: 'server',
    })
  return out
}

/**
 * Result для сбоя ВНЕ конвейера (пул не поднялся, маршрут упал). Форма обязана
 * показать текст, а не получить 500: поля здесь неизвестны, поэтому все ошибки
 * общие — без `path`.
 */
export function failureHandled(e: unknown): Handled {
  const { status } = toFormFailure(e, import.meta.env.DEV)
  return {
    status,
    result: {
      v: 1, formId: 'db_demo', instance: 'unknown:new', from: 'action',
      submissionId: '00000000-0000-4000-8000-000000000000', revision: 1,
      values: {}, ok: false, status, outcome: 'not-applied',
      errors: toFormErrors(e),
    },
  }
}

/** Пул поднимается один раз на запрос; сбой подъёма — тоже ошибка формы, не 500. */
async function withDb(run: (db: Database) => Promise<Handled>): Promise<Handled> {
  try {
    const { db } = await getRuntime()
    return await run(db)
  } catch (e) {
    return failureHandled(e)
  }
}

export function handleDbCreate(
  request: Request, from: 'action' | 'fetch', dbCtx: DataContext,
): Promise<Handled> {
  return withDb((db) =>
    createFormHandler<{ message: string }>({
      description: dbCreate,
      order: SECURITY_LAYERS,
      async execute({ values, commit, fail }) {
        try {
          const row = await db.resource(posts).insert(dbCtx, { title: String(values.title ?? '') })
          commit()
          return { data: { message: `создано: ${String(row.title ?? '')}` } }
        } catch (e) {
          // commit() не позван → исход «not-applied», ошибок «не знаю, применилось» нет.
          return fail(toFormErrors(e))
        }
      },
    })(request, from))
}

export function handleDbRemove(
  request: Request, from: 'action' | 'fetch', dbCtx: DataContext,
): Promise<Handled> {
  return withDb((db) =>
    createFormHandler<{ message: string; deleted: number }>({
      description: dbRemove,
      order: SECURITY_LAYERS,
      async execute({ values, commit, fail }) {
        const list = String(values.ids ?? '').split(',').map((s) => s.trim()).filter(Boolean)
        if (!list.length)
          return fail([{ id: 'ids:no-value:0', code: 'no-value', message: 'скопируйте id из таблицы ниже', path: 'ids', origin: 'server' }])
        const api = db.resource(posts)
        try {
          let deleted = 0
          for (const id of list) {
            await api.delete(dbCtx, id)
            deleted += 1
          }
          commit()
          return { data: { message: `удалено ${deleted}`, deleted } }
        } catch (e) {
          return fail(toFormErrors(e))
        }
      },
    })(request, from))
}

/**
 * Разбор по конверту: форма сама говорит, кто её принимает (тот же приём, что у
 * `/form/submit`). Набор описаний здесь НЕ приходит от клиента — по `__form_id`
 * сверяется статическое описание, иначе клиент мог бы прислать своё.
 */
export async function dispatchDbForm(
  request: Request, from: 'action' | 'fetch', dbCtx: DataContext,
): Promise<Handled> {
  const probe = await request.clone().formData().catch(() => null)
  // Только строка: `File` в этом поле — чужое тело, и сравнивать его бессмысленно.
  const id = typeof probe?.get('__form_id') === 'string' ? (probe.get('__form_id') as string) : ''
  if (id === dbCreate.id) return handleDbCreate(request, from, dbCtx)
  if (id === dbRemove.id) return handleDbRemove(request, from, dbCtx)
  return {
    status: 400,
    result: {
      v: 1, formId: id ?? 'unknown', instance: 'unknown:new', from,
      submissionId: '00000000-0000-4000-8000-000000000000', revision: 0,
      values: {}, ok: false, status: 400, outcome: 'not-applied',
      errors: [{ id: '*:envelope.unknown-form:0', code: 'envelope.unknown-form',
        message: 'Неизвестная форма: сервер не принимает такой `__form_id`', origin: 'server' }],
    },
  }
}
