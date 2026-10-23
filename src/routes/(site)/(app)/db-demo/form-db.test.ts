/**
 * Демо «формы и БД»: правила `title` описаны один раз — в модели `posts`, форма `dbCreate`
 * получает из них валидаторы (`formParams`). Проверяется настоящая пара: CHECK колонки,
 * `pick` с меткой «проверено», поле только формы (`agree`), адрес из заголовка (`fill`)
 * и очистка заголовка на сервере (`prepare`) с подсказкой под полем.
 */
import { PGlite } from '@electric-sql/pglite'
import { afterAll, describe, expect, it } from 'vitest'
import { createDb, conservativeLimits, DbFailure, failureIssues } from '#lib/db/index.js'
import { pgliteAdapter } from '#lib/db/adapters/pglite.js'
import { defineSchema } from '#lib/db/sync/index.js'
import { tableSpec } from '#lib/db/sync/model.js'
import { formParams } from '#hooks/db-form.js'
import { buildEnvelope, readProof } from '#lib/form/index.js'
import { createFormHandler } from '#lib/form/server.js'
import { dbCreate } from './description'
import { posts, slugOf } from '#content/demo-catalog/posts/posts.js'
import { createPrepare, stripLinks } from './prepare'

const author = { principal: { roles: ['author'] } }
let pg: PGlite | undefined
afterAll(async () => { await pg?.close() })

const kinds = (refs: readonly unknown[]) => refs.map((r) => (r as { describe: () => { kind: string }[] }).describe()[0]?.kind)

describe('модель posts → форма dbCreate', () => {
  it('валидаторы title — из модели (обязательное, 3–120), с меткой; slug заполняет модель — в форме его нет', async () => {
    const post = formParams(posts)
    expect(formParams(posts)).toBe(post)
    expect(kinds(post.title.validate)).toEqual(['required', 'minLength', 'maxLength'])
    expect(post.title.rulesFrom?.schema).toBe(posts.fields.title.schema)
    expect(kinds(post.slug.validate)).toEqual(['maxLength'])
    const title = dbCreate.byName['title']!
    expect(title.validators).toEqual(post.title.validate)
    expect(title.rulesFrom).toBe(post.title.rulesFrom)
    expect(dbCreate.byName['slug']).toBeUndefined()
    // CHECK заголовка прежний: имя объекта зависит только от выражения
    const spec = await tableSpec(posts)
    expect(spec.objects.filter((o) => o.kind === 'check').map((o) => o.sql)).toEqual([
      'char_length("title") BETWEEN 3 AND 120',
      'char_length("slug") <= 80',
    ])
  })

  it('slugOf и stripLinks', () => {
    expect(slugOf('  Заметка из Превью!  ')).toBe('заметка-из-превью')
    expect(slugOf('!!!')).toBeUndefined()
    expect(slugOf('a'.repeat(100))).toHaveLength(80)
    expect(stripLinks('см. https://example.com/x и www.test.ru тут')).toBe('см. и тут')
    expect(stripLinks('  без   ссылок ')).toBe('  без   ссылок ')
  })

  it('форма → запись: pick с меткой, agree до базы не идёт, slug из заголовка, prepare с подсказкой', async () => {
    pg = new PGlite()
    const driver = pgliteAdapter(pg)
    expect((await defineSchema({ resources: [posts] }).sync(driver)).status).toBe('ok')
    const db = createDb({ driver, limits: conservativeLimits })
    const api = db.resource(posts)

    const seen: { picked?: Record<string, unknown>; values?: Record<string, unknown> } = {}
    const handler = createFormHandler({
      description: dbCreate,
      prepare: createPrepare,
      async execute({ values, pick, commit }) {
        seen.values = values
        seen.picked = pick(['title'])
        await api.insert(author, seen.picked)
        commit()
        return {}
      },
    })
    const request = (fields: Record<string, string>) => new Request('http://x/db', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        ...buildEnvelope({ formId: dbCreate.id, revision: dbCreate.revision, instance: `${dbCreate.id}:new`, submissionId: crypto.randomUUID() }, dbCreate.policy),
        ...fields,
      }),
    })

    const ok = await handler(request({ title: 'Заметка из формы', agree: 'on' }))
    expect(ok.result.ok).toBe(true)
    expect(ok.result.notes).toBeUndefined()
    expect(seen.picked).toEqual({ title: 'Заметка из формы' })
    expect(readProof(seen.picked)?.fields['title']?.schema).toBe(posts.fields.title.schema)
    expect(readProof(seen.values)).toBeUndefined()

    const noAgree = await handler(request({ title: 'Заметка' }))
    expect(noAgree.result.errors.map((e) => [e.path, e.code, e.message])).toEqual([
      ['agree', 'required', 'Подтвердите согласие с правилами'],
    ])
    expect((await handler(request({ title: 'ab', agree: 'on' }))).result.errors.map((e) => e.code)).toEqual(['minLength'])

    // очистка до правил: сохраняется очищенное, подсказка — в notes
    const cleaned = await handler(request({ title: 'Смотрите https://example.com/x тут', agree: 'on' }))
    expect(cleaned.result.ok).toBe(true)
    expect(cleaned.result.notes).toEqual({ title: 'Текст изменён: удалены ссылки' })
    // очищенное стало короче трёх: ошибка под полем, в поле — очищенное значение
    const short = await handler(request({ title: 'ab https://example.com', agree: 'on' }))
    expect(short.result.errors.map((e) => e.code)).toEqual(['minLength'])
    expect(short.result.values['title']).toBe('ab')
    expect(short.result.notes).toEqual({ title: 'Текст изменён: удалены ссылки' })

    const rows = await api.select(author)
    expect(rows.map((r) => [r.title, r.slug]).sort()).toEqual([
      ['Заметка из формы', 'заметка-из-формы'],
      ['Смотрите тут', 'смотрите-тут'],
    ])

    // всё значение формы целиком (с agree) база не примет: поле не из модели
    await expect(api.insert(author, { title: 'Заметка', agree: true })).rejects.toSatisfy((e: unknown) =>
      e instanceof DbFailure && e.kind === 'forbidden')
    // подделанная метка с короткой строкой: правила схемы пропущены по метке — остановил CHECK
    const forged = Object.defineProperty({ title: 'ab' }, Symbol.for('modals-kit.validated-proof.v1'), {
      value: { fields: { title: { schema: posts.fields.title.schema, value: 'ab' } } },
    })
    await expect(api.insert(author, forged)).rejects.toSatisfy((e: unknown) =>
      e instanceof DbFailure && failureIssues(e)?.[0]?.code === 'check')
    // запись из кода (импорт): метки нет — база проверяет правилами модели, без очистки
    await expect(api.insert(author, { title: 'ab' })).rejects.toSatisfy((e: unknown) =>
      e instanceof DbFailure && failureIssues(e)?.[0]?.code === 'minLength')
    expect((await api.insert(author, { title: 'Импорт https://example.com' })).title).toBe('Импорт https://example.com')
  }, 30_000)
})
