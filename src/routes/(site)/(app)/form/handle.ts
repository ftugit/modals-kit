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
import { localStore } from '#lib/server/cache.js'
import { SECURITY_LAYERS } from '#lib/server/form-security.js'
import { applyOps, editor, groupRows, type FormDescription, type SchemaOp } from '#lib/form/index.js'
import '#lib/components/form/extend.js'
import { checks } from '#lib/components/form/extend.js'
import { resolveDescription, signup } from './signup'

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

/**
 * Строки повторяемой группы по ключам из тела: клиент добавил строку до отправки.
 * Валидаторы строк — из СЕРВЕРНОГО шаблона группы, клиент передаёт только ключ.
 * Поля, которые собирает пользователь, живут на `/fields` (`defineFieldKit` +
 * `createAppSource`): набор поднимает сервер, а не тело запроса.
 */
function expandFor(base: FormDescription, form: FormData | null): FormDescription {
  if (!form) return base
  const ops: SchemaOp[] = []
  const rows = new Set<string>()
  const groups = new Set(Object.keys(groupRows(base.fields)))
  for (const key of form.keys()) {
    if (typeof key !== 'string' || base.byName[key]) continue
    const m = /^([a-z][a-z0-9_]*)\.([a-z0-9_]+)\./.exec(key)
    if (m && groups.has(m[1]!) && !rows.has(m[2]!)) {
      rows.add(m[2]!)
      ops.push(editor.addRow(m[1]!, m[2]!))
    }
  }
  return ops.length ? applyOps(base, ops) : base
}

function handlerFor(description: typeof signup) {
  return createFormHandler<unknown, RequestEvent>({
    description,
    // Слой 02 (origin) включён проектом, а не оставляется на волю маршрута:
    // «забыл указать origin» иначе означает «принимаем межсайтовый POST».
    order: SECURITY_LAYERS,
    checks,
      idempotency,
    throttle,
    async execute({ values, intent, commit }) {
      // служебные действия ничего не создают: набор полей меняет адаптер
      if (intent !== 'submit' && intent !== 'save-draft') { commit(); return {} }
      demo.incr('created', Infinity)
      commit()
      return { data: { email: values['email'] } }
    },
  })
}

export async function handleSignup(
  request: Request, from: 'action' | 'fetch', event: RequestEvent,
): Promise<Handled> {
  // набор полей НЕ приходит от клиента: описание поднимается по конверту
  const probe = await request.clone().formData().catch(() => null)
  const description = resolveDescription(probe?.get('__form_id'), probe?.get('__form_spec'))
  if (!description)
    return {
      status: 400,
      result: {
        v: 1, formId: 'unknown', instance: 'unknown:new', from,
        submissionId: '00000000-0000-4000-8000-000000000000', revision: 0,
        values: {}, ok: false, status: 400, outcome: 'not-applied',
        errors: [{ id: '*:envelope.missing:0', code: 'envelope.missing',
                   message: 'Запрос отклонён: не хватает конверта', origin: 'server' }],
      },
    }
  let expanded: FormDescription
  try {
    expanded = expandFor(description, probe)
  } catch (error) {
    // Чужое тело не должно превращать превышение лимитов схемы в HTTP 500.
    return {
      status: 413,
      result: {
        v: 1, formId: description.id, instance: 'unknown:new', from,
        submissionId: '00000000-0000-4000-8000-000000000000', revision: description.revision,
        values: {}, ok: false, status: 413, outcome: 'not-applied',
        errors: [{ id: '*:request.too-large:0', code: 'request.too-large',
          message: 'Запрос содержит слишком много динамических полей', origin: 'server',
          params: { detail: error instanceof Error ? error.message : String(error) } }],
      },
    }
  }
  return handlerFor(expanded)(request, from, event)
}
