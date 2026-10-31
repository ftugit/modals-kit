// Серверный POST-обработчик демо-формы (`#hooks/component-form`).
//
// Раньше у маршрута было два приёмника: `actions.default` (нативный POST) и
// `submit/+server.ts` (fetch + опрос очереди). Оба существовали только ради
// одной формы; теперь приём один и живёт регистрацией — маршрут остаётся
// страницей, `submit/+server.ts` удалён, а опрос задачи (`queued`) идёт на
// адрес самой формы (`?__form_id=…&__form_task=…`).
import type { RequestEvent } from '@sveltejs/kit'
import { createFormHandler, storeIdempotency, windowThrottle } from '#lib/form/server.js'
import { queuedData, type Result } from '#lib/form/index.js'
import { localStore } from '#server/cache.server.js'
import { watchDb } from '#server/db.server.js'
import { registerComponentForm } from '#hooks/component-form/registry.js'
import '#components/form/extend.js'
import { ANSWERS, resolveDescription, signup, type Answer } from './signup'
import { countCreated, jobStatus, queueJob, QUEUE_DELAY_MS } from './queue.server.js'

// Бронь отправки — в памяти процесса: этой форме база не нужна, и общая бронь
// сделала бы сервер БД её единственной зависимостью (см. `#lib/server/cache.ts`).
// Потолок — с запасом на отправки за сутки (срок брони и результата).
const idempotency = storeIdempotency(localStore.scope('demo-form:idempotency', { max: 10_000 }))
// Лимит — на адрес клиента (F18): `getClientAddress()` учитывает настройки
// адаптера (ADDRESS_HEADER/XFF_DEPTH), сырые x-forwarded-for не читаются.
// Окна — в области `localStore` с потолком: адресов за минуту может быть сколько
// угодно, а память процесса — нет.
const throttle = windowThrottle<RequestEvent>({
  limit: 30, windowMs: 60_000,
  key: (_request, event) => event!.getClientAddress(),
  store: localStore.scope('demo-form:throttle', { max: 10_000 }),
})

/** Адрес опроса задачи — на самом адресе формы: отдельный эндпоинт не нужен. */
const pollHref = (event: RequestEvent, job: string): string =>
  `${event.url.pathname}?__form_id=${encodeURIComponent(signup.id)}&__form_task=${encodeURIComponent(job)}`

registerComponentForm({
  description: signup,
  // Режим ошибок — версия описания из конверта (`__form_spec`): страница, открытая до
  // переключения, получит своё описание. Тело запроса до слоёв не читается.
  source: { resolve: async (ctx) => resolveDescription(ctx.specVersion), revision: async () => signup.revision },
  // Слой 02 (origin) ставит сам приёмник (`#hooks/component-form`): форма не
  // может «забыть» защиту — набор слоёв у всех встраиваемых форм один.
  idempotency,
  throttle,
  async execute({ values, intent, commit }, event) {
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
      const job = await queueJob({ email: values['email'], count: intent === 'submit' })
      commit()
      return { queued: { pollUrl: pollHref(event, job), statusUrl: `/form?job=${job}`, etaMs: QUEUE_DELAY_MS } }
    }
    // Считаются только созданные: черновик аккаунта не создаёт.
    if (intent === 'submit') await countCreated()
    commit()
    // «Переход»: адрес уходит в `Result.redirect`; без JS маршрут отвечает 303,
    // с JS страница переходит сама (`+page.svelte`).
    if (answer === 'redirect') return { data: { email: values['email'] }, redirect: '/form?sent=1' }
    return { data: { email: values['email'] } }
  },
  // Без JS: «переход» и «в очереди» (`statusUrl`) — `303` на названный адрес,
  // остальное — страница в том же ответе с результатом (`locals.formResult` → `page.data.formResult`).
  redirectOnSuccess: (_event, result: Result) =>
    result.redirect ?? queuedData(result)?.statusUrl ?? 'inline',
  watch: [watchDb],
  // Опрос задачи: `{ done:false, retryAfterMs }` или `{ done:true, result }`.
  task: { poll: (id) => jobStatus(id) },
})
