// Серверный контур встраиваемых форм компонентов (`src/hooks/component-form`).
//
// Связка `#lib/form` × SvelteKit `Handle`: компонент со своей формой может
// монтироваться на любой странице или в модалке поверх любого маршрута, у
// которого нет собственного `+page.server.ts` с `actions`.
//
// Механика без костылей (никаких flash-кук и записей в кэш):
//   - все `*.form.server.ts` в проекте обнаруживаются лениво при первом POST через
//     `import.meta.glob` без циклической оценки модулей в `vite dev`;
//   - GET / прочие методы и чужие POST без зарегистрированного `__form_id`
//     проходят напрямую в `resolve(event)` без накладных расходов;
//   - с JS (`Accept: application/json`) — возвращает `{ data: { result } }` со
//     статусом обработчика и всеми выставленными в `execute` куками;
//   - без JS при `outcome === 'not-applied'` (черновые мутации мест `+ поле` / `Удалить`)
//     или `redirectOnSuccess -> 'inline'` — рендерит текущую страницу inline со статусом `200`;
//   - без JS при применённом успехе — штатный `303 See Other` на целевой/текущий адрес;
//   - без JS при ошибке — кладёт `event.locals.formResult = result` и рендерит
//     текущую страницу прямо в ответе на этот же запрос со статусом ошибки.
import { redirect, type RequestEvent } from '@sveltejs/kit'
import type { Handle } from '@sveltejs/kit/hooks'
import { taskResponse } from '#hooks/task-stream.server.js'
import { createFormHandler } from '#lib/form/server.js'
import { bodyBudget, envLimits } from '#server/form-budget.server.js'
import { SECURITY_LAYERS } from '#server/form-security.server.js'
import type { FormDescription, Result } from '#lib/form/index.js'
import { createAuthorizeGuards } from './authorize.server.js'
import { componentFormRegistry, registerComponentForm } from './registry.js'
import type { ComponentFormRegistration } from './types.js'

export { registerComponentForm }

/** Параметры опроса задачи: адрес формы + `__form_id` называют регистрацию. */
const TASK_PARAM = '__form_task'
const FORM_PARAM = '__form_id'
const NO_STORE = { 'cache-control': 'no-store' } as const

const isJsonRequest = (request: Request): boolean =>
  (request.headers.get('accept') ?? '').includes('application/json')

const isFormBody = (request: Request): boolean => {
  const ct = (request.headers.get('content-type') ?? '').toLowerCase()
  return ct.includes('application/x-www-form-urlencoded') || ct.includes('multipart/form-data')
}

function resolveDescription(reg: ComponentFormRegistration, event: RequestEvent): FormDescription {
  return typeof reg.description === 'function' ? reg.description(event) : reg.description
}

/**
 * Ограниченное чтение копии тела для распознавания конверта `__form_id`:
 * поток больше верхнего предела всех зарегистрированных форм никогда не
 * буферизуется целиком в RAM до `bodyLayer`.
 */
async function peekFormDataBounded(request: Request, capBytes: number): Promise<FormData | 'too-large' | null> {
  const declared = Number(request.headers.get('content-length') ?? 0)
  if (declared > capBytes) return 'too-large'
  const clone = request.clone()
  if (!clone.body) return clone.formData().catch(() => null)

  let seen = 0
  const chunks: Uint8Array[] = []
  const reader = clone.body.getReader()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      seen += value.byteLength
      if (seen > capBytes) {
        await reader.cancel().catch(() => undefined)
        return 'too-large'
      }
      chunks.push(value)
    }
  } catch {
    return null
  }
  const merged = new Uint8Array(seen)
  let offset = 0
  for (const c of chunks) {
    merged.set(c, offset)
    offset += c.byteLength
  }
  return new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body: merged,
  })
    .formData()
    .catch(() => null)
}

async function renderInlineWithResult(
  event: RequestEvent,
  resolve: Parameters<Handle>[0]['resolve'],
  result: Result,
  status: number,
  setCookies: ReadonlyMap<string, string>,
): Promise<Response> {
  const getHeaders = new Headers(event.request.headers)
  getHeaders.delete('content-type')
  getHeaders.delete('content-length')
  event.locals.formResult = result

  const rendered = await resolve({
    ...event,
    request: new Request(event.url, { method: 'GET', headers: getHeaders }),
  })
  const headers = new Headers(rendered.headers)
  for (const cookie of setCookies.values()) headers.append('set-cookie', cookie)
  return new Response(rendered.body, {
    status,
    statusText: rendered.statusText,
    headers,
  })
}

/**
 * Создаёт SvelteKit `Handle` для приёма POST встраиваемых форм на любом маршруте.
 * Карту модулей `import.meta.glob('./**\/*.form.server.ts')` передаёт composition root
 * (`src/hooks.server.ts`), поэтому слой `#hooks/*` не имеет ни одного восходящего импорта.
 */
let sharedModules: Record<string, () => Promise<unknown>> = {}
let sharedLoadedPromise: Promise<void> | undefined

/** Дождаться ленивой загрузки всех `*.form.server.ts` (общее для HTTP POST и `wss://` форм). */
export function ensureComponentFormsLoaded(): Promise<void> {
  return (sharedLoadedPromise ??= Promise.all(
    Object.values(sharedModules).map((load) => load()),
  ).then(() => undefined))
}

export function createComponentFormsHandle(
  modules: Record<string, () => Promise<unknown>> = {},
): Handle {
  if (Object.keys(modules).length > 0) {
    sharedModules = modules
    sharedLoadedPromise = undefined
  }
  const ensureLoaded = ensureComponentFormsLoaded

  return async ({ event, resolve }) => {
    // Опрос задачи (`queued`): тот же адрес, что у формы, но GET и без тела.
    // Маршруту для этого больше не нужна собственная точка входа.
    if (event.request.method === 'GET' && event.url.searchParams.has(TASK_PARAM)) {
      await ensureLoaded()
      const taskId = event.url.searchParams.get(TASK_PARAM) ?? ''
      const formId = event.url.searchParams.get(FORM_PARAM) ?? ''
      const entry = componentFormRegistry().get(formId)
      if (!entry?.task || !taskId) {
        return Response.json({ error: 'task.missing' }, { status: 404, headers: NO_STORE })
      }
      const answer = await entry.task.poll(taskId, event)
      if (answer instanceof Response) return answer
      return Response.json(answer, { status: answer === undefined ? 404 : 200, headers: NO_STORE })
    }

    if (event.request.method !== 'POST' || !isFormBody(event.request)) {
      return resolve(event)
    }

    await ensureLoaded()
    const registry = componentFormRegistry()
    if (registry.size === 0) return resolve(event)

    // потолок окружения: больше него не пропустит ни платформа, ни `bodyLayer`
    const capBytes = bodyBudget()
    const raw = await peekFormDataBounded(event.request, capBytes)
    if (raw === null) return resolve(event)
    if (raw === 'too-large') {
      return isJsonRequest(event.request)
        ? Response.json({ message: 'слишком большое тело запроса' }, { status: 413 })
        : new Response('слишком большое тело запроса', { status: 413 })
    }

    let matched: ComponentFormRegistration | undefined
    for (const [id, entry] of registry) {
      const desc = resolveDescription(entry, event)
      if (raw.get(desc.policy.envelopeKeys.id) === id) {
        matched = entry
        break
      }
    }
    if (!matched) return resolve(event)

    const reg = matched
    const description = resolveDescription(reg, event)
    const setCookies = new Map<string, string>()
    const trackedCookies: RequestEvent['cookies'] = {
      ...event.cookies,
      get: (name, opts) => event.cookies.get(name, opts),
      getAll: (opts) => event.cookies.getAll(opts),
      serialize: (name, value, opts) => event.cookies.serialize(name, value, opts),
      set: (name, value, opts) => {
        event.cookies.set(name, value, opts)
        setCookies.set(name, event.cookies.serialize(name, value, opts))
      },
      delete: (name, opts) => {
        event.cookies.delete(name, opts)
        setCookies.set(name, event.cookies.serialize(name, '', { ...opts, maxAge: 0 }))
      },
    }
    const trackedEvent: RequestEvent = { ...event, cookies: trackedCookies }
    const resolvedChecks = typeof reg.checks === 'function' ? await reg.checks(trackedEvent) : reg.checks
    const authGuards = createAuthorizeGuards(reg, trackedEvent, () => raw)

    const handler = createFormHandler<unknown, RequestEvent>({
      description,
      order: authGuards.layer ? [...SECURITY_LAYERS, authGuards.layer] : SECURITY_LAYERS,
      ...(reg.source ? { source: reg.source } : {}),
      ...(authGuards.schema ? { schema: authGuards.schema } : {}),
      ...(resolvedChecks ? { checks: resolvedChecks } : {}),
      // пределы — от окружения: тело = потолок, один файл = бюджет файлов;
      // частные пределы регистрации только уменьшают оба числа
      limits: envLimits(reg.limits ?? {}),
      ...(reg.idempotency ? { idempotency: reg.idempotency } : {}),
      ...(reg.throttle ? { throttle: reg.throttle } : {}),
      ...(reg.prepare ? { prepare: reg.prepare } : {}),
      execute: (ctx) => reg.execute(ctx, trackedEvent, raw),
    })

    const { result, status } = await handler(event.request, 'action', trackedEvent)
    if (isJsonRequest(event.request)) {
      const headers = new Headers()
      for (const cookie of setCookies.values()) headers.append('set-cookie', cookie)
      // Ход долгой операции (запуск базы, перенос схемы) — строками ответа, если
      // клиент их просил; форма с `watch` больше не нуждается в своём эндпоинте.
      return taskResponse(
        event.request,
        // Код ответа — тот же, что назвал конвейер (у `queued` — 202).
        async () => Response.json({ data: { result } }, { status: status || 200, headers }),
        { watch: reg.watch ?? [] },
      )
    }

    if (result.ok) {
      if (result.outcome === 'not-applied') {
        return renderInlineWithResult(event, resolve, result, 200, setCookies)
      }
      const target = reg.redirectOnSuccess?.(event, result)
      if (target === 'inline') {
        return renderInlineWithResult(event, resolve, result, 200, setCookies)
      }
      redirect(303, target ?? event.url.pathname + event.url.search)
    }

    return renderInlineWithResult(event, resolve, result, status, setCookies)
  }
}

export const componentFormsHandle: Handle = createComponentFormsHandle()
