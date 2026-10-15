// Серверная половина демо БД: приём идёт через слои lib/form — метод, origin,
// лимит тела, проверка имён, потом валидация и execute. Маршрут обязан
// остаться тонким: собственный `request.formData()` в маршруте layer-guard
// роняет сборку именно потому, что он выбрасывает всё перечисленное молча.
import { failureIssues, type Database, type DataContext } from '#lib/db/index.js'
import { toFormFailure } from '#lib/db/sveltekit/index.js'
import { createFormHandler, type Handled } from '#lib/form/server.js'
import type { FormError } from '#lib/form/index.js'
import { db, posts } from '#lib/server/db.js'
import { invalidateLiveCache } from '#lib/server/live-cache.js'
import { SECURITY_LAYERS } from '#lib/server/form-security.js'
import { dbCreate, dbRemove } from './description'
import { createPrepare } from './prepare'
import { SCHEMA_FORM_ID } from './schema'
import { handleSchemaResolve } from './schema-handle'

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

/** БД открывается при первом запросе; сбой открытия — тоже ошибка формы, не 500. */
async function withDb(run: (db: Database) => Promise<Handled>): Promise<Handled> {
  try {
    return await run(db)
  } catch (e) {
    return failureHandled(e)
  }
}

export function handleDbCreate(
  request: Request, from: 'action' | 'fetch', dbCtx: DataContext,
): Promise<Handled> {
  return withDb((db) =>
    createFormHandler<{ message: string; created?: { id: string; title: string; slug: string | null; created_at: string } }>({
      description: dbCreate,
      order: SECURITY_LAYERS,
      // Только сервер и ДО правил формы: правила (3–120) проверяют уже очищенный заголовок,
      // а при ошибке в поле вернётся он же — человек видит то, что будет сохранено.
      prepare: createPrepare,
      async execute({ pick, commit, fail }) {
        try {
          // В базу — только её поля: `agree` остаётся у формы. `pick` ставит на копию метку
          // «проверено» для `title`, и запись не повторит правила модели.
          const row = await db.resource(posts).insert(dbCtx, pick(['title']))
          commit()
          // Условный GET не должен пережить собственную запись: «304» на следующем
          // тике спрятал бы строку, которую человек только что добавил.
          invalidateLiveCache()
          // `created` — не украшение: это единственное, чего клиент знать не может
          // (`id` и `created_at` назначает сервер). С ними оптимистичная карточка
          // заменяется НА МЕСТЕ, без пересборки окна и без скачка.
          return {
            data: {
              message: `создано: ${String(row.title ?? '')}`,
              created: {
                id: String(row.id ?? ''),
                title: String(row.title ?? ''),
                slug: typeof row.slug === 'string' ? row.slug : null,
                created_at: String(row.created_at ?? ''),
              },
            },
          }
        } catch (e) {
          // commit() не позван → исход «не применено». Ошибки полей БД (длина, «уже
          // занято») идут под свои поля с текстами из словарей формы; прочее — общее.
          return fail(failureIssues(e) ?? toFormErrors(e))
        }
      },
    })(request, from))
}

export function handleDbRemove(
  request: Request, from: 'action' | 'fetch', dbCtx: DataContext,
): Promise<Handled> {
  return withDb((db) =>
    createFormHandler<{ message: string; deleted: number; removed: string[] }>({
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
          invalidateLiveCache()
          // `removed` — какие именно строки ушли: по ним список правит окно на
          // месте (`patchItems`), а не перезагружается.
          return { data: { message: `удалено ${deleted}`, deleted, removed: list } }
        } catch (e) {
          // «на запись ссылаются» приходит общей ошибкой с кодом — текст из словаря
          return fail(failureIssues(e) ?? toFormErrors(e))
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
  if (id === SCHEMA_FORM_ID) {
    // `null` — решать уже нечего (успел другой экземпляр): тот же итог, что у успеха —
    // страница перечитает данные и покажет список
    const handled = await handleSchemaResolve(request, from).catch((e) => failureHandled(e))
    return handled ?? {
      status: 200,
      result: {
        v: 1, formId: SCHEMA_FORM_ID, instance: `${SCHEMA_FORM_ID}:new`, from,
        submissionId: '00000000-0000-4000-8000-000000000000', revision: 1,
        values: {}, ok: true, status: 200, outcome: 'committed', errors: [],
        data: { message: 'Схема уже в порядке' },
      },
    }
  }
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
