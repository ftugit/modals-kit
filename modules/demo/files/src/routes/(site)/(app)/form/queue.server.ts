// Очередь демо `/form`: «заявка принята сейчас, запись — через 5 секунд».
//
// Хранение — в `sharedStore` (`cache_kv` в Postgres/PGlite, TTL 24 ч), чтобы
// состояние заявки и счётчик созданных записей переживали рестарт процесса и
// разделялись между бессерверными инстансами. Таймеров нет: готовность —
// сравнение времени при опросе (`jobStatus`).
import { sharedStore } from '#server/cache.server.js'
import type { PgStore } from '#hooks/cache-db.js'
import type { PollOutcome, Result } from '#lib/form/index.js'
import { signup } from './signup.js'

export const QUEUE_DELAY_MS = 5_000
export const QUEUE_TTL_MS = 24 * 60 * 60 * 1000

interface Job {
  readyAt: number
  email: unknown
  done: boolean
  count: boolean
}

export interface DemoFormQueue {
  queueJob(input: { email: unknown; count: boolean }): Promise<string>
  countCreated(): Promise<void>
  createdCount(): Promise<number>
  jobStatus(id: string): Promise<PollOutcome | undefined>
}

/**
 * Собрать очередь поверх указанного `PgStore` (в проде — `sharedStore`,
 * в тестах — два независимых экземпляра `pgStore(db)` поверх одной БД).
 */
export function createDemoFormQueue(
  store: PgStore = sharedStore,
  now: () => number = Date.now,
): DemoFormQueue {
  const jobs = store.scope('demo-form:jobs', { max: 1_000 })
  // Счётчик созданных — число в `cache_kv`, а не список адресов.
  const demo = store.scope('demo-form:stats', { max: 16 })

  return {
    async queueJob(input) {
      const id = crypto.randomUUID()
      await jobs.set<Job>(
        id,
        {
          readyAt: now() + QUEUE_DELAY_MS,
          email: input.email,
          done: false,
          count: input.count,
        },
        QUEUE_TTL_MS,
      )
      return id
    },

    async countCreated() {
      await demo.incr('created', Infinity)
    },

    async createdCount() {
      return (await demo.get<number>('created')) ?? 0
    },

    async jobStatus(id) {
      const job = await jobs.get<Job>(id)
      if (!job) return undefined
      const left = job.readyAt - now()
      if (left > 0) return { done: false, retryAfterMs: Math.min(left, 1_000) }
      if (!job.done) {
        // Атомарная отметка `add`: параллельный опрос с двух инстансов
        // увеличит счётчик `created` ровно один раз.
        const firstFinish = await jobs.add(`${id}:done`, true, QUEUE_TTL_MS)
        if (firstFinish && job.count) {
          await demo.incr('created', Infinity)
        }
        await jobs.set<Job>(id, { ...job, done: true }, QUEUE_TTL_MS)
      }
      const result: Result = {
        v: 1,
        formId: signup.id,
        instance: `${signup.id}:new`,
        submissionId: id,
        ok: true,
        status: 200,
        outcome: 'committed',
        errors: [],
        values: {},
        revision: signup.revision,
        from: 'fetch',
        data: { email: job.email },
      }
      return { done: true, result }
    },
  }
}

const defaultQueue = createDemoFormQueue()

/** Поставить заявку в очередь; возвращает её идентификатор. */
export function queueJob(input: { email: unknown; count: boolean }): Promise<string> {
  return defaultQueue.queueJob(input)
}

/** Засчитать созданную запись (вне очереди). */
export function countCreated(): Promise<void> {
  return defaultQueue.countCreated()
}

/** Состояние заявки: `undefined` — заявки нет (истекла или чужая). */
export function jobStatus(id: string): Promise<PollOutcome | undefined> {
  return defaultQueue.jobStatus(id)
}
