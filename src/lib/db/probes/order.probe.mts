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
const ctx = { principal: { roles: [] as string[] } }
const s = new Sql()
const sql = await filterSQL(res, ctx, { and: [ { field: 'a', op: 'eq', value: 111 }, { field: 'b', op: 'eq', value: 222 } ] }, s, {
  pageSize: 20, maxPageSize: 100, maxPage: 10000, filterDepth: 8, filterNodes: 100, inValues: 100, inputKeys: 64 })
console.log('SQL   :', sql)
console.log('VALUES:', s.values)
// Асинхронные схемы полей резолвятся в своём порядке (у `a` задержка 30 мс, у `b` — 1 мс),
// поэтому значения в массиве идут не по тексту фильтра. Проверяется не порядок, а
// привязка: каждый $n в тексте обязан указывать на значение своего поля.
const expected: Record<string, number> = { a: 111, b: 222 }
const pairs = [...sql.matchAll(/"x"\."([a-z])" = \$(\d+)/g)].map((m) => [m[1]!, Number(m[2])])
const bad = pairs.filter(([field_, n]) => s.values[n - 1] !== expected[field_])
if (pairs.length !== 2 || bad.length) {
  console.log('ORDER BROKEN:', JSON.stringify(pairs), 'vs', JSON.stringify(s.values))
  process.exit(1)
}
console.log('ORDER OK: каждый $n указывает на значение своего поля (порядок не源-последовательный)'.replace('源',''))
