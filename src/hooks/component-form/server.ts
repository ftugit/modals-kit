// Серверный контур встраиваемых форм компонентов (`src/hooks/component-form`).
//
// Связка `#lib/form` × SvelteKit `Handle`: компонент со своей формой может
// монтироваться на любой странице или в модалке поверх любого маршрута, у
// которого нет собственного `+page.server.ts` с `actions`.
//
// Механика без костылей (никаких flash-кук и записей в кэш):
//   - GET / прочие методы и чужие POST без зарегистрированного `__form_id`
//     проходят напрямую в `resolve(event)` без накладных расходов;
//   - с JS (`Accept: application/json`) — возвращает `{ data: { result } }` со
//     статусом обработчика и всеми выставленными в `execute` куками;
//   - без JS при успехе — штатный `303 See Other` на целевой/текущий адрес (или
//     прямой рендер при `redirectOnSuccess -> 'inline'` для пошаговых форм);
//   - без JS при ошибке — кладёт `event.locals.formResult = result` и рендерит
//     текущую страницу прямо в ответе на этот же запрос со статусом ошибки.
import { redirect, type RequestEvent } from '@sveltejs/kit'
import type { Handle } from '@sveltejs/kit/hooks'
import { createFormHandler } from '#lib/form/server.js'
import { SECURITY_LAYERS } from '#lib/server/form-security.js'
import type { Result } from '#lib/form/index.js'
import type { ComponentFormRegistration } from './types.js'

const registry = new Map<string, ComponentFormRegistration>()

/** Зарегистрировать серверный POST-обработчик встраиваемой формы компонента. */
export function registerComponentForm(reg: ComponentFormRegistration): void {
  registry.set(reg.description.id, reg)
}

const isJsonRequest = (request: Request): boolean =>
  (request.headers.get('accept') ?? '').includes('application/json')

const isFormBody = (request: Request): boolean => {
  const ct = (request.headers.get('content-type') ?? '').toLowerCase()
  return ct.includes('application/x-www-form-urlencoded') || ct.includes('multipart/form-data')
}

async function renderInlineWithResult(
  event: RequestEvent,
  resolve: Parameters<Handle>[0]['resolve'],
  result: Result,
  status: number,
  setCookies: readonly string[],
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
  for (const cookie of setCookies) headers.append('set-cookie', cookie)
  return new Response(rendered.body, {
    status,
    statusText: rendered.statusText,
    headers,
  })
}

/** SvelteKit `Handle` для приёма POST встраиваемых форм на любом маршруте. */
export const componentFormsHandle: Handle = async ({ event, resolve }) => {
  if (event.request.method !== 'POST' || registry.size === 0 || !isFormBody(event.request)) {
    return resolve(event)
  }

  const raw = await event.request.clone().formData().catch(() => null)
  if (!raw) return resolve(event)

  let matched: ComponentFormRegistration | undefined
  for (const [id, entry] of registry) {
    if (raw.get(entry.description.policy.envelopeKeys.id) === id) {
      matched = entry
      break
    }
  }
  if (!matched) return resolve(event)

  const reg = matched
  const setCookies: string[] = []
  const trackedCookies: RequestEvent['cookies'] = {
    ...event.cookies,
    get: (name, opts) => event.cookies.get(name, opts),
    getAll: (opts) => event.cookies.getAll(opts),
    serialize: (name, value, opts) => event.cookies.serialize(name, value, opts),
    set: (name, value, opts) => {
      event.cookies.set(name, value, opts)
      setCookies.push(event.cookies.serialize(name, value, opts))
    },
    delete: (name, opts) => {
      event.cookies.delete(name, opts)
      setCookies.push(event.cookies.serialize(name, '', { ...opts, maxAge: 0 }))
    },
  }
  const trackedEvent: RequestEvent = { ...event, cookies: trackedCookies }

  const handler = createFormHandler<unknown, RequestEvent>({
    description: reg.description,
    order: SECURITY_LAYERS,
    ...(reg.checks ? { checks: reg.checks } : {}),
    ...(reg.limits ? { limits: reg.limits } : {}),
    execute: (ctx) => reg.execute(ctx, trackedEvent),
  })

  const { result, status } = await handler(event.request, 'action', trackedEvent)
  if (isJsonRequest(event.request)) {
    const headers = new Headers()
    for (const cookie of setCookies) headers.append('set-cookie', cookie)
    return Response.json({ data: { result } }, { status: result.ok ? 200 : status, headers })
  }

  if (result.ok) {
    const target = reg.redirectOnSuccess?.(event, result)
    if (target === 'inline') {
      return renderInlineWithResult(event, resolve, result, 200, setCookies)
    }
    redirect(303, target ?? event.url.pathname + event.url.search)
  }

  return renderInlineWithResult(event, resolve, result, status, setCookies)
}
