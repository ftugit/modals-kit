/**
 * Postgres-хранилище: тот же контракт, что у памяти процесса, но часы и
 * атомарность — базы. Каждый тест — на свежей схеме PGlite (настоящий
 * PostgreSQL в WASM): таблица разворачивается sync-ом из модели `cacheKv`,
 * как в приложении при подключении.
 */
import { PGlite } from '@electric-sql/pglite'
import { afterAll, describe, expect, it } from 'vitest'
import { conservativeLimits, createDb, type Database } from '#lib/db/index.js'
import { pgliteAdapter } from '#lib/db/adapters/pglite.js'
import { defineSchema } from '#lib/db/sync/index.js'
import { isAtomic, requireAtomic } from './index'
import { cacheKv, pgStore, type PgStore } from './pg'

const test = (name: string, fn: () => Promise<void>) => it(name, fn, 30_000)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/*
 * Один PGlite на файл: экземпляр — ~100 МБ WASM-памяти (как в db-sync.test).
 * Между проверками схема `public` пересоздаётся, модель разворачивает gate.
 */
let shared: PGlite | undefined
afterAll(async () => { await shared?.close() })

async function fresh(): Promise<{ pg: PGlite; db: Database; store: PgStore }> {
  shared ??= new PGlite()
  await shared.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
  const gated = await defineSchema({ resources: [cacheKv] }).gate(pgliteAdapter(shared))
  const db = createDb({ driver: gated, limits: conservativeLimits })
  return { pg: shared, db, store: pgStore(db) }
}

describe('pgStore: модель и таблица', () => {
  test('sync создаёт таблицу из модели: колонки, типы, уникальность (scope, key)', async () => {
    const { pg } = await fresh()
    const cols = (await pg.query<{ name: string; type: string }>(
      `SELECT a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type
         FROM pg_attribute a
        WHERE a.attrelid = 'public.cache_kv'::regclass AND a.attnum > 0 AND NOT a.attisdropped
        ORDER BY a.attnum`)).rows
    expect(cols).toEqual([
      { name: 'id', type: 'uuid' },
      { name: 'scope', type: 'text' },
      { name: 'key', type: 'text' },
      { name: 'value', type: 'jsonb' },
      { name: 'expires_at', type: 'timestamp with time zone' },
    ])
    await pg.query(`INSERT INTO public.cache_kv (scope, key, value) VALUES ('s', 'k', '1'::jsonb)`)
    await expect(pg.query(`INSERT INTO public.cache_kv (scope, key, value) VALUES ('s', 'k', '2'::jsonb)`))
      .rejects.toThrow()
  })
})

describe('pgStore: срок и значения', () => {
  test('запись живёт ttl по часам базы; Infinity — без срока', async () => {
    const { store } = await fresh()
    await store.set('a', 1, 60)
    expect(await store.get('a')).toBe(1)
    await sleep(90)
    expect(await store.get('a')).toBeUndefined()
    await store.set('b', 2, Infinity)
    await sleep(30)
    expect(await store.get('b')).toBe(2)
  })

  test('ноль, отрицательный и NaN ttl — RangeError до похода в базу', async () => {
    const { store } = await fresh()
    await expect(store.set('b', 1, 0)).rejects.toThrow(RangeError)
    await expect(store.set('b', 1, -5)).rejects.toThrow(RangeError)
    await expect(store.add('b', 1, Number.NaN)).rejects.toThrow(RangeError)
    await expect(store.incr('b', 0)).rejects.toThrow(RangeError)
  })

  test('set перезаписывает значение и срок; JSON ходит туда-обратно', async () => {
    const { store } = await fresh()
    await store.set('k', { nested: [1, 'два', true, null] }, 40)
    await store.set('k', { nested: [] }, 5_000)
    await sleep(60)
    expect(await store.get('k')).toEqual({ nested: [] })
    await store.set('s', 'строка', 1e6)
    await store.set('n', null, 1e6)
    expect(await store.get('s')).toBe('строка')
    expect(await store.get('n')).toBeNull()
  })

  test('просроченное вычищается записью нового инстанса, а не только скрывается чтением', async () => {
    const { db, store } = await fresh()
    await store.set('old', 1, 30)
    await sleep(50)
    await pgStore(db).set('fresh', 2, 1e6)
    const rows = (await db.query<{ c: number }>({ text: 'SELECT count(*)::int AS c FROM public.cache_kv' })).rows
    expect(rows[0]?.c).toBe(1)
  })
})

describe('pgStore: атомарные операции', () => {
  test('add занимает свободный ключ один раз; после срока ключ снова свободен', async () => {
    const { store } = await fresh()
    expect(await store.add('k', 'first', 60)).toBe(true)
    expect(await store.add('k', 'second', 60)).toBe(false)
    expect(await store.get('k')).toBe('first')
    await sleep(90)
    expect(await store.add('k', 'third', 1e6)).toBe(true)
    expect(await store.get('k')).toBe('third')
  })

  test('параллельные add одного ключа: ровно один true', async () => {
    const { store } = await fresh()
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => store.add('race', i, 1e6)))
    expect(results.filter(Boolean)).toHaveLength(1)
  })

  test('incr: окно фиксировано с первого вызова, следующие его не продлевают', async () => {
    const { store } = await fresh()
    expect(await store.incr('n', 140)).toBe(1)
    await sleep(80)
    expect(await store.incr('n', 140)).toBe(2)
    await sleep(80)
    expect(await store.incr('n', 140)).toBe(1) // окно истекло через 140 мс от ПЕРВОГО вызова
  })

  test('incr поверх не числа — TypeError, запись не тронута', async () => {
    const { store } = await fresh()
    await store.set('k', 'text', 1e6)
    await expect(store.incr('k', 1e6)).rejects.toThrow(TypeError)
    expect(await store.get('k')).toBe('text')
  })

  test('requireAtomic пропускает pgStore при подключении', async () => {
    const { store } = await fresh()
    expect(isAtomic(store)).toBe(true)
    expect(() => requireAtomic(store, 'бронь отправки')).not.toThrow()
  })
})

describe('pgStore: области', () => {
  test('одинаковые ключи в разных областях не пересекаются; scope("a:b") = scope("a").scope("b")', async () => {
    const { store } = await fresh()
    await store.scope('a').set('k', 'A', 1e6)
    await store.scope('b').set('k', 'B', 1e6)
    await store.scope('a').scope('inner').set('k', 'AI', 1e6)
    expect(await store.scope('a').get('k')).toBe('A')
    expect(await store.scope('b').get('k')).toBe('B')
    expect(await store.get('k')).toBeUndefined()
    expect(await store.scope('a:inner').get('k')).toBe('AI')
  })

  test('clear чистит свою область и вложенные, но не соседние; пустое имя — TypeError', async () => {
    const { store } = await fresh()
    const a = store.scope('a')
    await a.set('k', 1, 1e6)
    await a.scope('inner').set('k', 2, 1e6)
    await store.scope('ab').set('k', 3, 1e6)
    await a.clear()
    expect(await a.get('k')).toBeUndefined()
    expect(await a.scope('inner').get('k')).toBeUndefined()
    expect(await store.scope('ab').get('k')).toBe(3) // 'ab' — сосед, не вложенная в 'a'
    expect(() => store.scope('')).toThrow(TypeError)
  })

  test('delete убирает один ключ своей области', async () => {
    const { store } = await fresh()
    await store.scope('a').set('k', 1, 1e6)
    await store.scope('b').set('k', 2, 1e6)
    await store.scope('a').delete('k')
    expect(await store.scope('a').get('k')).toBeUndefined()
    expect(await store.scope('b').get('k')).toBe(2)
  })
})
