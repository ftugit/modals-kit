/**
 * Демо «формы и БД» (шаг 5 docs/design/db-form-validation-answers.md): поле `title`
 * описано один раз — в форме `dbCreate`, а модель `posts` берёт его схемой колонки.
 * Проверяется настоящая пара: CHECK таблицы прежний (развёрнутая БД не видит изменений),
 * значения с меткой формы не проверяются второй раз, без метки — проверяются теми же
 * правилами.
 */
import { PGlite } from '@electric-sql/pglite'
import { afterAll, describe, expect, it } from 'vitest'
import { createDb, conservativeLimits, defineResource, DbFailure, failureIssues, field, s } from '#lib/db/index.js'
import { pgliteAdapter } from '#lib/db/adapters/pglite.js'
import { defineSchema } from '#lib/db/sync/index.js'
import { tableSpec } from '#lib/db/sync/model.js'
import { buildEnvelope, fieldSchema, readProof } from '#lib/form/index.js'
import { createFormHandler } from '#lib/form/server.js'
import { dbCreate } from '#lib/demo/db-form/description.js'
import { posts } from './posts'

const author = { principal: { roles: ['author'] } }
let pg: PGlite | undefined
afterAll(async () => { await pg?.close() })

describe('posts.title = поле формы dbCreate.title', () => {
  it('тип и CHECK колонки — те же, что давал s.text({ min: 3, max: 120 }): имя объекта не меняется', async () => {
    const before = defineResource({
      ...posts,
      fields: { ...posts.fields, title: field(s.text({ min: 3, max: 120 }), { ...posts.fields.title }) },
    })
    const now = await tableSpec(posts)
    const was = await tableSpec(before)
    expect(now.columns).toEqual(was.columns)
    expect(now.objects).toEqual(was.objects)
    // отпечаток в kit_schema тот же: открытие уже развёрнутой БД ничего не применяет
    expect(now.fingerprint).toBe(was.fingerprint)
    expect(now.objects.find((o) => o.kind === 'check')?.sql).toBe('char_length("title") BETWEEN 3 AND 120')
  })

  it('форма → запись: метка формы принята (правила не повторены), без метки — те же правила в БД', async () => {
    pg = new PGlite()
    const driver = pgliteAdapter(pg)
    expect((await defineSchema({ resources: [posts] }).sync(driver)).status).toBe('ok')
    const db = createDb({ driver, limits: conservativeLimits })
    const api = db.resource(posts)

    // настоящий приём формы: execute получает значения с меткой и пишет их как есть
    const handler = createFormHandler({
      description: dbCreate,
      async execute({ values, commit }) {
        expect(readProof(values)?.fields['title']?.schema).toBe(fieldSchema(dbCreate, 'title'))
        await api.insert(author, values)
        commit()
        return {}
      },
    })
    const request = (title: string) => new Request('http://x/db', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        ...buildEnvelope({ formId: dbCreate.id, revision: dbCreate.revision, instance: `${dbCreate.id}:new`, submissionId: crypto.randomUUID() }, dbCreate.policy),
        title,
      }),
    })
    expect((await handler(request('Заметка из формы'))).result.ok).toBe(true)
    expect((await handler(request('ab'))).result.errors.map((e) => e.code)).toEqual(['minLength'])

    // подделанная метка с короткой строкой: правила схемы пропущены по метке — остановил CHECK
    const title = fieldSchema(dbCreate, 'title')
    const forged = Object.defineProperty({ title: 'ab' }, Symbol.for('modals-kit.validated-proof.v1'), {
      value: { fields: { title: { schema: title, value: 'ab' } } },
    })
    await expect(api.insert(author, forged)).rejects.toSatisfy((e: unknown) =>
      e instanceof DbFailure && failureIssues(e)?.[0]?.code === 'check')

    // запись без формы (JSON, API): метки нет — БД проверяет правилами поля формы
    await expect(api.insert(author, { title: 'ab' })).rejects.toSatisfy((e: unknown) =>
      e instanceof DbFailure && failureIssues(e)?.[0]?.code === 'minLength')
    await expect(api.insert(author, { title: 'x'.repeat(121) })).rejects.toSatisfy((e: unknown) =>
      e instanceof DbFailure && failureIssues(e)?.[0]?.code === 'maxLength')

    expect((await api.select(author)).map((r) => r.title)).toEqual(['Заметка из формы'])
  }, 30_000)
})
