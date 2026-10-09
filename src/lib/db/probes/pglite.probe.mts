import { PGlite } from '@electric-sql/pglite'
import { Sql, filterSQL } from '../query/sql.ts'
import { defineResource, field } from '../validation.ts'

const asyncSchema = (delay: number) => ({
  '~standard': { version: 1 as const, vendor: 'probe', validate: async (v: unknown) => {
    await new Promise((r) => setTimeout(r, delay)); return { value: v as number }
  } },
})
const res = defineResource({
  key: 'probe.x', table: 'x', primaryKey: 'id',
  fields: {
    id: field(asyncSchema(0), { read: () => true, filters: ['eq'], orderable: true }),
    a: field(asyncSchema(30), { read: () => true, filters: ['eq'], orderable: true }),
    b: field(asyncSchema(1), { read: () => true, filters: ['eq'], orderable: true }),
  },
  policy: { select: () => true, insert: () => false, update: () => false, delete: () => false },
  order: [['id', 'asc']],
})
const pg = new PGlite()
await pg.exec('CREATE TABLE x (id serial primary key, a int, b int); INSERT INTO x (a,b) VALUES (111,222),(222,111);')
const ctx = { principal: { roles: [] as string[] } }
const s = new Sql()
const where = await filterSQL(res, ctx, { and: [{ field: 'a', op: 'eq', value: 111 }, { field: 'b', op: 'eq', value: 222 }] }, s,
  { pageSize: 20, maxPageSize: 100, maxPage: 10000, filterDepth: 8, filterNodes: 100, inValues: 100, inputKeys: 64 })
const stmt = s.statement(`SELECT id, a, b FROM x WHERE ${where}`)
console.log('TEXT  :', stmt.text)
console.log('VALUES:', stmt.values)
const r = await pg.query(stmt.text, [...(stmt.values ?? [])])
console.log('ROWS  :', JSON.stringify(r.rows))
console.log(r.rows.length === 1 && r.rows[0].a === 111 && r.rows[0].b === 222
  ? 'СВЯЗКА ВЕРНА: асинхронная схема не ломает привязку $n к значениям'
  : 'ОШИБКА ПРИВЯЗКИ: вернулись не те строки')
await pg.close()
