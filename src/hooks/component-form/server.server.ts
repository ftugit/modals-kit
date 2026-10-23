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
import { createFormHandler, DEFAULT_LIMITS } from '#lib/form/server.js'
import { SECURITY_LAYERS } from '#server/form-security.server.js'
import type { FormDescription, Result } from '#lib/form/index.js'
import { componentFormRegistry, registerComponentForm } from './registry.js'
import type { ComponentFormRegistration } from './types.js'

export { registerComponentForm }

const isJsonRequest = (request: Request): boolean =>
  (request.headers.get('accept') ?? '').includes('application/json')

const isFormBody = (request: Request): boolean => {
  const ct = (request.headers.get('content-type') ?? '').toLowerCase()
  return ct.includes('application/x-www-form-urlencoded') || ct.includes('multipart/form-data')
}

function resolveDescription(reg: ComponentFormRegistration, event: RequestEvent): FormDescription {
  return typeof reg.description === 'function' ? reg.description(event) : reg.description
}

function maxRegisteredBytes(): number {
  let max = DEFAULT_LIMITS.maxBytes
  for (const reg of componentFormRegistry().values()) {
    const candidate = reg.limits?.maxBytes
    if (typeof candidate === 'number' && candidate > max) max = candidate
  }
  return max
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
export function createComponentFormsHandle(
  modules: Record<string, () => Promise<unknown>> = {},
): Handle {
  let loadedPromise: Promise<void> | undefined
  const ensureLoaded = (): Promise<void> =>
    (loadedPromise ??= Promise.all(Object.values(modules).map((load) => load())).then(
      () => undefined,
    ))

  return async ({ event, resolve }) => {
    if (event.request.method !== 'POST' || !isFormBody(event.request)) {
      return resolve(event)
    }

    await ensureLoaded()
    const registry = componentFormRegistry()
    if (registry.size === 0) return resolve(event)

    const capBytes = maxRegisteredBytes()
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

    const handler = createFormHandler<unknown, RequestEvent>({
      description,
      order: SECURITY_LAYERS,
      ...(reg.source ? { source: reg.source } : {}),
      ...(resolvedChecks ? { checks: resolvedChecks } : {}),
      ...(reg.limits ? { limits: reg.limits } : {}),
      execute: (ctx) => reg.execute(ctx, trackedEvent, raw),
    })

    const { result, status } = await handler(event.request, 'action', trackedEvent)
    if (isJsonRequest(event.request)) {
      const headers = new Headers()
      for (const cookie of setCookies.values()) headers.append('set-cookie', cookie)
      return Response.json({ data: { result } }, { status: result.ok ? 200 : status, headers })
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
