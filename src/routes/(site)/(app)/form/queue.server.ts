// Очередь демо `/form`: «заявка принята сейчас, запись — через 5 секунд».
//
// Таймеров нет: готовность — сравнение времени при опросе. Заявка живёт сутки,
// потолок — 1000 заявок. Состояние опрашивает регистрация формы
// (`signup.form.server.ts` → `#hooks/component-form`), поэтому модуль не знает
// ни про HTTP, ни про маршрут.
import { localStore } from '#server/cache.server.js'
import type { PollOutcome, Result } from '#lib/form/index.js'
import { signup } from './signup.js'

export const QUEUE_DELAY_MS = 5_000
const QUEUE_TTL_MS = 24 * 60 * 60 * 1000

interface Job { readyAt: number; email: unknown; done: boolean; count: boolean }
const jobs = localStore.scope('demo-form:jobs', { max: 1_000 })
// Счётчик созданных — число, а не список адресов: список рос без предела и держал
// в памяти введённые email.
const demo = localStore.scope('demo-form:stats', { max: 16 })

/** Поставить заявку в очередь; возвращает её идентификатор. */
export function queueJob(input: { email: unknown; count: boolean }): string {
  const id = crypto.randomUUID()
  jobs.set(id, { readyAt: Date.now() + QUEUE_DELAY_MS, email: input.email, done: false, count: input.count }, QUEUE_TTL_MS)
  return id
}

/** Засчитать созданную запись (вне очереди). */
export function countCreated(): void {
  demo.incr('created', Infinity)
}

/** Состояние заявки: `undefined` — заявки нет (истекла или чужая). */
export function jobStatus(id: string): PollOutcome | undefined {
  const job = jobs.get<Job>(id)
  if (!job) return undefined
  const left = job.readyAt - Date.now()
  if (left > 0) return { done: false, retryAfterMs: Math.min(left, 1_000) }
  if (!job.done) {
    // запись «случилась»: считаем один раз, при первом опросе после срока
    if (job.count) demo.incr('created', Infinity)
    jobs.set(id, { ...job, done: true }, QUEUE_TTL_MS)
  }
  // Итог очереди собирает приложение: та же форма и экземпляр, иначе связка его
  // не примет (`lift`); значения пустые — в полях остаётся набранное.
  const result: Result = {
    v: 1, formId: signup.id, instance: `${signup.id}:new`, submissionId: id,
    ok: true, status: 200, outcome: 'committed', errors: [], values: {},
    revision: signup.revision, from: 'fetch', data: { email: job.email },
  }
  return { done: true, result }
}
