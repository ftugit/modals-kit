import { PGlite } from '@electric-sql/pglite'
import { afterAll, describe, expect, it } from 'vitest'
import { conservativeLimits, createDb } from '#lib/db/index.js'
import { pgliteAdapter } from '#lib/db/adapters/pglite.js'
import { defineSchema } from '#lib/db/sync/index.js'
import { cacheKv, pgStore } from '#hooks/cache-db.js'
import { createDemoFormQueue, QUEUE_DELAY_MS } from './queue.server.js'

let shared: PGlite | undefined
afterAll(async () => {
  await shared?.close()
})

async function createTwoInstances() {
  shared ??= new PGlite()
  await shared.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
  const gated = await defineSchema({ resources: [cacheKv] }).gate(pgliteAdapter(shared))
  const dbA = createDb({ driver: gated, limits: conservativeLimits })
  const dbB = createDb({ driver: gated, limits: conservativeLimits })
  let clock = 1_700_000_000_000
  const now = () => clock
  const advance = (ms: number) => {
    clock += ms
  }
  return {
    instanceA: createDemoFormQueue(pgStore(dbA), now),
    instanceB: createDemoFormQueue(pgStore(dbB), now),
    advance,
  }
}

describe('очередь /form поверх sharedStore (cache_kv)', () => {
  it(
    'заявка, принятая на инстансе A, видна и завершается на инстансе B с ровно одним инкрементом created',
    async () => {
      const { instanceA, instanceB, advance } = await createTwoInstances()

      const id = await instanceA.queueJob({ email: 'alice@example.com', count: true })
      expect(await instanceB.jobStatus('00000000-0000-4000-8000-000000000000')).toBeUndefined()

      // До истечения 5 с инстанс B видит заявку в процессе
      const pending = await instanceB.jobStatus(id)
      expect(pending).toEqual({ done: false, retryAfterMs: 1_000 })
      expect(await instanceA.createdCount()).toBe(0)

      // Сдвигаем время за порог готовности и одновременно опрашиваем с обоих инстансов
      advance(QUEUE_DELAY_MS + 50)
      const [doneA, doneB] = await Promise.all([
        instanceA.jobStatus(id),
        instanceB.jobStatus(id),
      ])

      expect(doneA?.done).toBe(true)
      expect(doneB?.done).toBe(true)
      if (doneB?.done) {
        expect(doneB.result.ok).toBe(true)
        expect(doneB.result.outcome).toBe('committed')
        expect(doneB.result.data).toEqual({ email: 'alice@example.com' })
      }
      // Атомарная бронь `${id}:done` гарантирует одиночный учёт созданного аккаунта
      expect(await instanceA.createdCount()).toBe(1)
      expect(await instanceB.createdCount()).toBe(1)
    },
    30_000,
  )

  it(
    'черновик (count: false) завершает заявку без увеличения счётчика created',
    async () => {
      const { instanceA, instanceB, advance } = await createTwoInstances()
      const id = await instanceA.queueJob({ email: 'draft@example.com', count: false })
      advance(QUEUE_DELAY_MS + 10)
      const done = await instanceB.jobStatus(id)
      expect(done?.done).toBe(true)
      expect(await instanceB.createdCount()).toBe(0)
    },
    30_000,
  )
})
