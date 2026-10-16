// Серверный приём через слои библиотеки.
//
// Метод, источник запроса, предел тела со счётчиком потока, проверка имён,
// конверт, описание, идемпотентность, частота, асинхронные проверки и
// обработчик ошибок — всё в одном конвейере. Приложение пишет только execute.
// Отдельная точка входа: серверные слои не должны попасть в браузерный бандл.
import type { RequestEvent } from '@sveltejs/kit'
import {
  createFormHandler, storeIdempotency, windowThrottle, type Handled,
} from '#lib/form/server.js'
import type { PollOutcome, Result } from '#lib/form/index.js'
import { localStore } from '#lib/server/cache.js'
import { SECURITY_LAYERS } from '#lib/server/form-security.js'
import '#lib/components/form/extend.js'
import { checks } from '#lib/components/form/extend.js'
import { ANSWERS, resolveDescription, signup, type Answer } from './signup'

// Бронь отправки — в памяти процесса: этой форме база не нужна, и общая бронь
// сделала бы сервер БД её единственной зависимостью (см. `#lib/server/cache.ts`).
// Потолок — с запасом на отправки за сутки (срок брони и результата).
const idempotency = storeIdempotency(localStore.scope('demo-form:idempotency', { max: 10_000 }))
// Лимит — на адрес клиента (F18): `getClientAddress()` учитывает настройки
// адаптера (ADDRESS_HEADER/XFF_DEPTH), сырой x-forwarded-for не читается.
// Маршрут обязан передать event: без него ключ бросает, а не сводит всех в одно окно.
// Окна — в области `localStore` с потолком: адресов за минуту может быть сколько
// угодно, а память процесса — нет (у встроенной карты ограничителя потолка нет).
// 10 000 окон × ≤30 меток — сотни КБ; вытесняется давно не писавший адрес.
const throttle = windowThrottle<RequestEvent>({
  limit: 30, windowMs: 60_000,
  key: (_request, event) => event!.getClientAddress(),
  store: localStore.scope('demo-form:throttle', { max: 10_000 }),
})

// Счётчик созданных — число, а не список адресов: список рос без предела и держал
// в памяти введённые email.
const demo = localStore.scope('demo-form:stats', { max: 16 })
export const createdCount = (): number => demo.get<number>('created') ?? 0

/* ── очередь (симуляция) ────────────────────────────────────────────
   «В очереди»: сервер принимает заявку и отвечает сразу, а запись становится
   успешной через QUEUE_DELAY_MS. Таймеров нет: готовность — сравнение времени
   при опросе. Заявка живёт сутки, потолок — 1000 заявок. */
export const QUEUE_DELAY_MS = 5_000
const QUEUE_TTL_MS = 24 * 60 * 60 * 1000
interface Job { readyAt: number; email: unknown; done: boolean; count: boolean }
const jobs = localStore.scope('demo-form:jobs', { max: 1_000 })

/** Состояние заявки: `undefined` — заявки нет (истекла или чужой адрес). */
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

const handler = createFormHandler<unknown, RequestEvent>({
  description: signup,
  // Режим ошибок — версия описания из конверта (`__form_spec`): страница, открытая до
  // переключения, получит своё описание. Тело запроса до слоёв не читается.
  source: { resolve: async (ctx) => resolveDescription(ctx.specVersion), revision: async () => signup.revision },
  // Слой 02 (origin) включён проектом, а не оставляется на волю маршрута:
  // «забыл указать origin» иначе означает «принимаем межсайтовый POST».
  order: SECURITY_LAYERS,
  checks,
  idempotency,
  throttle,
  async execute({ values, intent, commit }) {
    // «Проверить контакты» ничего не создаёт: правила своих полей уже прошли.
    if (intent === 'check-contacts') {
      commit()
      return { data: { checked: ['email', 'phone'] } }
    }
    // Демо: ответ выбирает скрытое поле `answer` (панель «Ответ сервера»).
    const answer = (ANSWERS as readonly string[]).includes(String(values['answer'])) ? values['answer'] as Answer : 'accept'
    // «Неизвестно»: обработчик не подтвердил успех (`commit` не вызван) —
    // библиотека не выдаёт это за успех, исход `unknown`, повтор не советуется.
    if (answer === 'unknown') return {}
    // «В очереди»: заявка принята (`commit`), запись — через 5 секунд. Адрес
    // опроса — для скрипта, адрес статуса — ссылка без него.
    if (answer === 'queued') {
      const job = crypto.randomUUID()
      jobs.set(job, { readyAt: Date.now() + QUEUE_DELAY_MS, email: values['email'], done: false,
                     count: intent === 'submit' }, QUEUE_TTL_MS)
      commit()
      return { queued: { pollUrl: `/form/submit?job=${job}`, statusUrl: `/form?job=${job}`, etaMs: QUEUE_DELAY_MS } }
    }
    // Считаются только созданные: черновик аккаунта не создаёт.
    if (intent === 'submit') demo.incr('created', Infinity)
    commit()
    // «Переход»: адрес уходит в `Result.redirect`; без JS маршрут отвечает 303,
    // с JS страница переходит сама (`+page.svelte`).
    if (answer === 'redirect') return { data: { email: values['email'] }, redirect: '/form?sent=1' }
    return { data: { email: values['email'] } }
  },
})

export const handleSignup = (request: Request, from: 'action' | 'fetch', event: RequestEvent): Promise<Handled> =>
  handler(request, from, event)
