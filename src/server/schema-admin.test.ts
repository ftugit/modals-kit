// Перенос схемы по кнопке: секрет до обращения к БД, решения из формы, причины отказа.
import { PGlite } from '@electric-sql/pglite'
import { afterAll, expect, it } from 'vitest'
import { defineResource, f, field, policy, s } from '#lib/db/index.js'
import type { Driver, Fields, Resource } from '#lib/db/index.js'
import { pgliteAdapter } from '#lib/db/adapters/pglite.js'
import { defineSchema, stepKey } from '#lib/db/sync/index.js'
import { createSchemaAdmin, decisionsFromForm } from './schema-admin.server.js'

const TOKEN = 'a'.repeat(40)
const open = { read: () => true } as const
const rules = {
  select: policy.publicRows(),
  insert: () => true,
  update: policy.publicRows(),
  delete: policy.publicRows(),
}
const post = (extra: Fields) =>
  defineResource({
    key: 't.post',
    table: 'public.post',
    primaryKey: 'id',
    fields: {
      id: f.uuid({
        ...open,
        orderable: true,
        filters: ['eq'],
        db: { default: 'gen_random_uuid()' },
      }),
      title: field(s.text({ min: 1, max: 50 }), {
        ...open,
        create: () => true,
        required: true,
      }),
      ...extra,
    },
    policy: rules,
    order: [['id', 'asc']],
  } as Resource)

let pg: PGlite | undefined
afterAll(async () => {
  await pg?.close()
})
async function conflicted(): Promise<{
  driver: Driver
  schema: ReturnType<typeof defineSchema>
}> {
  pg ??= new PGlite()
  await pg.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
  const driver = pgliteAdapter(pg)
  await defineSchema({
    resources: [post({ name: field(s.text(), { ...open, nullable: true }) })],
  }).sync(driver)
  await pg.query("INSERT INTO post (title, name) VALUES ('Запись', 'Иван')")
  return {
    driver,
    schema: defineSchema({
      resources: [post({ label: field(s.text(), { ...open, nullable: true }) })],
    }),
  }
}

it('решения из формы: только поля step:* с известным значением', () => {
  const data = new FormData()
  data.append('token', 'x')
  data.append('step:rename_or_replace:"public"."post":label', 'rename')
  data.append('step:extra_column:"public"."post":legacy', '')
  data.append('step:change_type:"public"."post":n', 'drop table')
  expect(decisionsFromForm(data)).toEqual({
    'rename_or_replace:"public"."post":label': 'rename',
  })
})

it('без секрета на сервере и с неверным секретом БД не трогается; с верным — перенос выполнен', async () => {
  const { driver, schema } = await conflicted()
  let opened = 0
  const counting = async () => (opened++, driver)
  const step = (await schema.sync(driver)).conflicts[0]!
  const decisions = { [stepKey(step)]: 'rename' as const }

  const off = createSchemaAdmin({ schema, driver: counting, token: undefined })
  expect(off.enabled).toBe(false)
  expect(await off.resolve(TOKEN, decisions)).toMatchObject({
    ok: false,
    reason: 'disabled',
  })
  const admin = createSchemaAdmin({ schema, driver: counting, token: TOKEN })
  for (const wrong of ['', 'b'.repeat(40), TOKEN.slice(1), undefined, 42])
    expect(await admin.resolve(wrong, decisions)).toMatchObject({
      ok: false,
      reason: 'token',
    })
  expect(opened).toBe(0)
  expect(await admin.resolve(TOKEN, {})).toMatchObject({
    ok: false,
    reason: 'invalid',
  })

  const done = await admin.resolve(TOKEN, decisions)
  expect(done).toMatchObject({ ok: true, report: { status: 'ok' } })
  expect((await pg!.query('SELECT label FROM post')).rows).toEqual([{ label: 'Иван' }])
  // экран устарел: шага больше нет
  expect(await admin.resolve(TOKEN, decisions)).toMatchObject({
    ok: false,
    reason: 'stale',
  })
})

it('база отклонила перенос — причина видна переносящему, ничего не изменено', async () => {
  const { driver } = await conflicted()
  await defineSchema({
    resources: [post({ name: field(s.text(), { ...open, nullable: true }) })],
  }).sync(driver)
  const typed = defineSchema({
    resources: [post({ name: f.integer({ ...open, nullable: true }) })],
  })
  const step = (await typed.sync(driver)).conflicts[0]!
  const admin = createSchemaAdmin({
    schema: typed,
    driver: async () => driver,
    token: TOKEN,
  })
  const out = await admin.resolve(TOKEN, { [stepKey(step)]: 'apply' })
  expect(out).toMatchObject({ ok: false, reason: 'failed' })
  expect((out as { message: string }).message).toMatch(/ничего не изменено/)
  expect((await pg!.query('SELECT name FROM post')).rows).toEqual([{ name: 'Иван' }])
})
