// Серверный контур встраиваемых форм компонентов.
//
// Проблема: компонент со своей формой (`bindRouteForm`) может монтироваться на
// любой странице приложения (`/user/profile`, `/paginator?page=2`, модалка
// поверх текущего маршрута). Если его `<form method="post">` указывает на
// чужой роут (`/user/auth`), нативный POST без JS выбрасывает пользователя с
// исходной страницы. А если `action` ведёт на текущий адрес страницы, у этой
// страницы не обязано быть собственного `+page.server.ts` с `actions`.
//
// Решение: компонент регистрирует серверный обработчик своей формы по
// `__form_id` здесь, а `componentFormsHandle` в `hooks.server.ts` перехватывает
// POST с этим `__form_id` на ЛЮБОМ маршруте приложения:
//   - с JS (`Accept: application/json`) — отдаёт `{ data: { result } }` со
//     статусом обработчика (распаковывается штатным `kitActionTransport`);
//   - без JS (нативный HTML POST) — при успехе делает `303` обратно на ту же
//     страницу (или адрес из `redirectOnSuccess`), а при ошибке сохраняет
//     одноразовый снимок `Result` в `localStore` под короткую HttpOnly-куку и
//     делает `303` на ту же страницу, где `handle` поднимет `locals.formResult`
//     для синхронного SSR-рендера `continuation`.
import { redirect, type Cookies, type RequestEvent } from '@sveltejs/kit'
import type { Handle } from '@sveltejs/kit/hooks'
import { createFormHandler, type ExecuteContext, type ExecuteOutput } from '#lib/form/server.js'
import type { FormDescription, Result } from '#lib/form/index.js'
import { SECURITY_LAYERS } from '#lib/server/form-security.js'
import { localStore } from '#lib/server/cache.js'

const FLASH_COOKIE = '__form_flash'
const FLASH_TTL_SECONDS = 30
const flashStore = localStore.scope('component-form-flash')

interface FlashRecord {
  readonly pathname: string
  readonly result: Result
}

export interface ComponentFormRegistration {
  readonly description: FormDescription
  readonly execute: (
    ctx: ExecuteContext,
    event: RequestEvent,
  ) => ExecuteOutput<unknown> | Promise<ExecuteOutput<unknown>>
  /**
   * Необязательное переопределение целевого адреса после успешного нативного
   * POST (без JS). По умолчанию возвращаем пользователя ровно на ту страницу,
   * где отрендерен компонент (`event.url.pathname + event.url.search`).
   */
  readonly redirectOnSuccess?: (event: RequestEvent, result: Result) => string | null | undefined
}

const registry = new Map<string, ComponentFormRegistration>()

/** Зарегистрировать серверный POST-обработчик формы встраиваемого компонента. */
export function registerComponentForm(reg: ComponentFormRegistration): void {
  registry.set(reg.description.id, reg)
}

const isJsonRequest = (request: Request): boolean =>
  (request.headers.get('accept') ?? '').includes('application/json')

const isFormBody = (request: Request): boolean => {
  const ct = (request.headers.get('content-type') ?? '').toLowerCase()
  return ct.includes('application/x-www-form-urlencoded') || ct.includes('multipart/form-data')
}

async function popFlashResult(cookies: Cookies, pathname: string): Promise<Result | null> {
  const token = cookies.get(FLASH_COOKIE)
  if (!token) return null
  cookies.delete(FLASH_COOKIE, { path: '/' })
  const saved = await flashStore.get<FlashRecord>(token)
  await flashStore.delete(token)
  if (!saved || saved.pathname !== pathname) return null
  return saved.result
}

async function pushFlashResult(cookies: Cookies, pathname: string, result: Result): Promise<void> {
  const token = crypto.randomUUID()
  await flashStore.set<FlashRecord>(token, { pathname, result }, FLASH_TTL_SECONDS * 1_000)
  cookies.set(FLASH_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: FLASH_TTL_SECONDS,
  })
}

/**
 * SvelteKit `Handle`: поднимает одноразовый `locals.formResult` на GET и
 * обслуживает POST встраиваемых форм на любом маршруте приложения.
 */
export const componentFormsHandle: Handle = async ({ event, resolve }) => {
  if (event.request.method !== 'POST') {
    event.locals.formResult = await popFlashResult(event.cookies, event.url.pathname)
    return resolve(event)
  }

  if (registry.size === 0 || !isFormBody(event.request)) {
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
    execute: (ctx) => reg.execute(ctx, trackedEvent),
  })

  const { result, status } = await handler(event.request, 'action', trackedEvent)
  if (isJsonRequest(event.request)) {
    const headers = new Headers()
    for (const cookie of setCookies) headers.append('set-cookie', cookie)
    return Response.json({ data: { result } }, { status: result.ok ? 200 : status, headers })
  }

  const samePage = event.url.pathname + event.url.search
  if (result.ok) {
    const target = reg.redirectOnSuccess?.(event, result) ?? samePage
    redirect(303, target)
  }

  await pushFlashResult(event.cookies, event.url.pathname, result)
  redirect(303, samePage)
}
