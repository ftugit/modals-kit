// Серверный POST трёх форм демо БД (`#hooks/component-form`).
//
// Раньше у страницы были `actions` (`?/create`, `?/rename`, `?/remove`) плюс
// перехваченный `submit/+server.ts` — две кодировки одного приёма. Теперь приём
// один и живёт регистрацией: конверт называет `__form_id`, приёмник находит
// описание и отвечает той кодировкой, которую просит клиент (JSON для `fetch`,
// страница в том же ответе — без JS).
//
// Разбор по конверту безопасен: набор описаний фиксирован здесь, клиент не может
// прислать своё.
import type { RequestEvent } from '@sveltejs/kit'
import { db, posts, watchDb } from '#server/db.server.js'
import { invalidateLiveCache } from '#server/live-cache.server.js'
import { registerComponentForm } from '#hooks/component-form/registry.js'
import { dbCreate, dbRemove, dbRename } from './description'
import { createPrepare } from './prepare'
import { failureIssuesOf } from './handle.server'

/** Контекст БД — доверенный, кладёт `hooks.server.ts`; маршрут его только читает. */
const ctx = (event: RequestEvent) => event.locals.dbCtx

registerComponentForm({
  description: dbCreate,
  // Только сервер и ДО правил формы: правила (3–120) проверяют уже очищенный
  // заголовок, а при ошибке в поле вернётся он же — человек видит то, что будет
  // сохранено.
  prepare: createPrepare,
  async execute({ pick, commit, fail }, event) {
    try {
      // В базу — только её поля: `agree` остаётся у формы. `pick` ставит на копию
      // метку «проверено» для `title`, и запись не повторит правила модели.
      const row = await db.resource(posts).insert(ctx(event), pick(['title']))
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
      return fail(failureIssuesOf(e))
    }
  },
  // Список обновляется самим клиентом (`onApplied`), а серверный итог нужен и
  // без скрипта: `inline` отдаёт страницу вместе с результатом (`formResult`).
  redirectOnSuccess: () => 'inline',
  // Ход запуска базы и переноса схемы — строками ответа (`task-stream`).
  watch: [watchDb],
})

registerComponentForm({
  description: dbRename,
  async execute({ values, commit, fail }, event) {
    const id = String(values.id ?? '').trim()
    const title = String(values.title ?? '')
    if (!id) {
      fail([{ id: 'id:no-value:0', code: 'no-value', message: 'скопируйте id из таблицы ниже', path: 'id', origin: 'server' }])
    }
    try {
      const row = await db.resource(posts).update(ctx(event), id, { title })
      commit()
      invalidateLiveCache()
      return {
        data: {
          message: `переименовано: ${String(row.title ?? '')}`,
          updated: {
            id: String(row.id ?? ''),
            title: String(row.title ?? ''),
            slug: typeof row.slug === 'string' ? row.slug : null,
            created_at: String(row.created_at ?? ''),
            updated_at: row.updated_at == null ? null : String(row.updated_at),
          },
        },
      }
    } catch (e) {
      return fail(failureIssuesOf(e))
    }
  },
  redirectOnSuccess: () => 'inline',
  watch: [watchDb],
})

registerComponentForm({
  description: dbRemove,
  async execute({ values, commit, fail }, event) {
    const list = String(values.ids ?? '').split(',').map((s) => s.trim()).filter(Boolean)
    if (!list.length) {
      fail([{ id: 'ids:no-value:0', code: 'no-value', message: 'скопируйте id из таблицы ниже', path: 'ids', origin: 'server' }])
    }
    const api = db.resource(posts)
    try {
      let deleted = 0
      for (const id of list) {
        await api.delete(ctx(event), id)
        deleted += 1
      }
      commit()
      invalidateLiveCache()
      // `removed` — какие именно строки ушли: по ним список правит окно на
      // месте (`patchItems`), а не перезагружается.
      return { data: { message: `удалено ${deleted}`, deleted, removed: list } }
    } catch (e) {
      return fail(failureIssuesOf(e))
    }
  },
  redirectOnSuccess: () => 'inline',
  watch: [watchDb],
})
