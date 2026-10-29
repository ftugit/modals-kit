// Серверный контур встраиваемых форм компонентов (`src/hooks/component-form`).
//
// Связка `#lib/form` × SvelteKit `Handle`: компонент со своей формой может
// монтироваться на любой странице или в модалке поверх любого маршрута, у
// которого нет собственного `+page.server.ts` с `actions` (а если есть — чужие
// POST без зарегистрированного `__form_id` передаются в `resolve` с целым телом).
//
// Механика без костылей и без двойной буферизации `request.clone()`:
//   - с JS (`x-form-id`) форма опознаётся до чтения тела и поток напрямую идёт в
//     `createFormHandler` (`bodyLayer`), если регистрации не нужен предразбор `raw`;
//   - без `x-form-id` (нативный POST без JS) поток читается один раз без `tee`;
//     при перевесе свыше `bodyBudget()` сканируются только первые 32 КиБ для
//     опознания `__form_id`, поток отменяется, а `413` формирует сам конвейер
//     формы (`{ data: { result } }` для JSON и SSR-страница с `formResult` без JS);
//   - при `outcome === 'queued'` без JS и без явного `redirectOnSuccess` выполняется
//     штатный `303 See Other` на `statusUrl`.
import { redirect, type RequestEvent } from '@sveltejs/kit'
import type { Handle } from '@sveltejs/kit/hooks'
import { taskResponse } from '#hooks/task-stream.server.js'
import { createFormHandler } from '#lib/form/server.js'
import { queuedData, type FormDescription, type Result } from '#lib/form/index.js'
import { bodyBudget, envLimits } from '#server/form-budget.server.js'
import { SECURITY_LAYERS } from '#server/form-security.server.js'
import { createAuthorizeGuards } from './authorize.server.js'
import { componentFormRegistry, registerComponentForm } from './registry.js'
import { FORM_ID_HEADER } from './transport.js'
import type { ComponentFormRegistration } from './types.js'

export { registerComponentForm }

/** Параметры опроса задачи: адрес формы + `__form_id` называют регистрацию. */
const TASK_PARAM = '__form_task'
const FORM_PARAM = '__form_id'
const NO_STORE = { 'cache-control': 'no-store' } as const
/** Предел чтения префикса для извлечения `__form_id` при перевесе тела без `x-form-id`. */
const PREFIX_SCAN_CAP = 32 * 1024

const isJsonRequest = (request: Request): boolean =>
  (request.headers.get('accept') ?? '').includes('application/json')

const isFormBody = (request: Request): boolean => {
  const ct = (request.headers.get('content-type') ?? '').toLowerCase()
  return ct.includes('application/x-www-form-urlencoded') || ct.includes('multipart/form-data')
}

function resolveDescription(reg: ComponentFormRegistration, event: RequestEvent): FormDescription {
  return typeof reg.description === 'function' ? reg.description(event) : reg.description
}

function needsRawFormData(reg: ComponentFormRegistration): boolean {
  return typeof reg.source === 'function' || Boolean(reg.authorize) || reg.execute.length >= 3
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function mergeChunks(chunks: readonly Uint8Array[], total: number): Uint8Array<ArrayBuffer> {
  const merged = new Uint8Array(new ArrayBuffer(total))
  let offset = 0
  for (const c of chunks) {
    merged.set(c, offset)
    offset += c.byteLength
  }
  return merged
}

/**
 * Извлечь строковое поле конверта (`__form_id`) из первых 32 КиБ тела, когда
 * запрос без заголовка `x-form-id` превысил `capBytes` и полный разбор отменён.
 */
function extractFieldFromPrefix(
  prefix: Uint8Array,
  contentType: string,
  fieldName: string,
  truncated: boolean,
): string | null {
  const text = new TextDecoder('utf-8', { fatal: false }).decode(prefix)
  const ct = contentType.toLowerCase()

  if (ct.includes('application/x-www-form-urlencoded')) {
    const parts = text.split('&')
    const completeParts = truncated && parts.length > 1 ? parts.slice(0, -1) : parts
    for (const part of completeParts) {
      const eq = part.indexOf('=')
      if (eq < 0) continue
      try {
        const k = decodeURIComponent(part.slice(0, eq).replace(/\+/g, ' '))
        if (k !== fieldName) continue
        return decodeURIComponent(part.slice(eq + 1).replace(/\+/g, ' '))
      } catch {
        continue
      }
    }
    return null
  }

  if (ct.includes('multipart/form-data')) {
    const re = new RegExp(
      `name="${escapeRegExp(fieldName)}"[^\\r\\n]*(?:\\r?\\n[^\\r\\n]+)*\\r?\\n\\r?\\n([^\\r\\n]{1,128})\\r?\\n--`,
      'i',
    )
    const m = re.exec(text)
    return m ? m[1]! : null
  }

  return null
}

function matchFromPrefix(
  registry: ReadonlyMap<string, ComponentFormRegistration>,
  event: RequestEvent,
  prefix: Uint8Array,
  truncated: boolean,
): ComponentFormRegistration | undefined {
  const contentType = event.request.headers.get('content-type') ?? ''
  for (const [id, entry] of registry) {
    const desc = resolveDescription(entry, event)
    const candidate = extractFieldFromPrefix(prefix, contentType, desc.policy.envelopeKeys.id, truncated)
    if (candidate === id) return entry
  }
  return undefined
}

type InspectedBody =
  | { kind: 'ok'; bytes: Uint8Array<ArrayBuffer>; formData: FormData | null }
  | { kind: 'too-large'; prefix: Uint8Array<ArrayBuffer>; truncated: boolean }
  | { kind: 'unreadable' }

/**
 * Однопроходное чтение тела без `request.clone()`:
 * - до `capBytes` собирает один буфер, из которого строится и `FormData`, и
 *   повторный `Request` для `createFormHandler` либо `resolve(event)`;
 * - свыше `capBytes` сохраняет не более `PREFIX_SCAN_CAP` байт для распознавания
 *   `__form_id` и немедленно отменяет остаток потока.
 */
async function readBoundedOnce(request: Request, capBytes: number): Promise<InspectedBody> {
  const declared = Number(request.headers.get('content-length') ?? 0)
  const declaredOversized = Number.isFinite(declared) && declared > capBytes

  if (!request.body) {
    if (declaredOversized) {
      return { kind: 'too-large', prefix: new Uint8Array(new ArrayBuffer(0)), truncated: false }
    }
    const empty = new Uint8Array(new ArrayBuffer(0))
    const formData = await new Request(request.url, {
      method: request.method,
      headers: request.headers,
      body: empty,
    })
      .formData()
      .catch(() => null)
    return { kind: 'ok', bytes: empty, formData }
  }

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  const prefixChunks: Uint8Array[] = []
  let seen = 0
  let prefixSeen = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      if (prefixSeen < PREFIX_SCAN_CAP) {
        const take = Math.min(value.byteLength, PREFIX_SCAN_CAP - prefixSeen)
        prefixChunks.push(take === value.byteLength ? value : value.subarray(0, take))
        prefixSeen += take
      }

      seen += value.byteLength
      if (declaredOversized) {
        if (prefixSeen >= PREFIX_SCAN_CAP) {
          await reader.cancel().catch(() => undefined)
          return { kind: 'too-large', prefix: mergeChunks(prefixChunks, prefixSeen), truncated: true }
        }
        continue
      }

      if (seen > capBytes) {
        await reader.cancel().catch(() => undefined)
        return { kind: 'too-large', prefix: mergeChunks(prefixChunks, prefixSeen), truncated: true }
      }
      chunks.push(value)
    }
  } catch {
    return { kind: 'unreadable' }
  }

  if (declaredOversized) {
    return { kind: 'too-large', prefix: mergeChunks(prefixChunks, prefixSeen), truncated: false }
  }

  const bytes = mergeChunks(chunks, seen)
  const formData = await new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body: bytes,
  })
    .formData()
    .catch(() => null)
  return { kind: 'ok', bytes, formData }
}

/** Собрать минимальный запрос, который штатно сработает в `bodyLayer` как `413 body.too-large`. */
function makeOversizedMarkerRequest(original: Request, capBytes: number): Request {
  const headers = new Headers(original.headers)
  headers.set('content-length', String(capBytes + 1))
  return new Request(original.url, {
    method: original.method,
    headers,
    body: new Uint8Array(new ArrayBuffer(0)),
  })
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

    const capBytes = bodyBudget()
    const headerFormId = event.request.headers.get(FORM_ID_HEADER)?.trim() ?? ''
    const headerMatched = headerFormId ? registry.get(headerFormId) : undefined
    const declared = Number(event.request.headers.get('content-length') ?? 0)
    const declaredOversized = Number.isFinite(declared) && declared > capBytes

    let matched: ComponentFormRegistration | undefined = headerMatched
    let raw: FormData = new FormData()
    let handlerRequest: Request = event.request
    let isOversizedBeforeParse = false

    // Быстрый путь: JS-транспорт прислал `x-form-id`, и форме не нужен предразбор
    // `raw` до `createFormHandler` (либо `Content-Length` уже превышает потолок) —
    // передаём поток напрямую в `bodyLayer` без промежуточного буфера.
    if (matched && (!needsRawFormData(matched) || declaredOversized)) {
      isOversizedBeforeParse = declaredOversized
    } else {
      const inspected = await readBoundedOnce(event.request, capBytes)
      if (inspected.kind === 'unreadable') {
        return Response.json({ code: 'body.unreadable', message: 'Unreadable request body' }, { status: 400 })
      }

      if (inspected.kind === 'too-large') {
        matched = matched ?? matchFromPrefix(registry, event, inspected.prefix, inspected.truncated)
        if (!matched) {
          return isJsonRequest(event.request)
            ? Response.json({ code: 'body.too-large', message: 'Request body too large' }, { status: 413 })
            : new Response('Request body too large', { status: 413 })
        }
        isOversizedBeforeParse = true
        handlerRequest = makeOversizedMarkerRequest(event.request, capBytes)
      } else {
        const replay = () =>
          new Request(event.request.url, {
            method: event.request.method,
            headers: event.request.headers,
            body: inspected.bytes,
          })

        if (!inspected.formData) {
          return resolve({ ...event, request: replay() })
        }
        raw = inspected.formData
        if (!matched) {
          for (const [id, entry] of registry) {
            const desc = resolveDescription(entry, event)
            if (raw.get(desc.policy.envelopeKeys.id) === id) {
              matched = entry
              break
            }
          }
        }
        if (!matched) {
          return resolve({ ...event, request: replay() })
        }
        handlerRequest = replay()
      }
    }

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
    const resolvedChecks =
      !isOversizedBeforeParse && typeof reg.checks === 'function'
        ? await reg.checks(trackedEvent)
        : typeof reg.checks !== 'function'
          ? reg.checks
          : undefined
    const resolvedSource =
      !isOversizedBeforeParse && typeof reg.source === 'function'
        ? await reg.source(trackedEvent, raw)
        : typeof reg.source === 'object'
          ? reg.source
          : undefined
    const authGuards = createAuthorizeGuards(reg, trackedEvent, () => raw)

    const handler = createFormHandler<unknown, RequestEvent>({
      description,
      order: authGuards.layer ? [...SECURITY_LAYERS, authGuards.layer] : SECURITY_LAYERS,
      ...(resolvedSource ? { source: resolvedSource } : {}),
      ...(authGuards.schema ? { schema: authGuards.schema } : {}),
      ...(resolvedChecks ? { checks: resolvedChecks } : {}),
      // пределы — от окружения: потолок `FORM_BODY_LIMIT` ограничивает сверху
      // как `reg.limits.budget`, так и `defineForm({ budget })`
      limits: envLimits(reg.limits ?? {}),
      ...(reg.idempotency ? { idempotency: reg.idempotency } : {}),
      ...(reg.throttle ? { throttle: reg.throttle } : {}),
      ...(reg.prepare ? { prepare: reg.prepare } : {}),
      execute: (ctx) => reg.execute(ctx, trackedEvent, raw),
    })

    const { result, status } = await handler(handlerRequest, 'action', trackedEvent)
    if (isJsonRequest(event.request)) {
      const headers = new Headers()
      for (const cookie of setCookies.values()) headers.append('set-cookie', cookie)
      return taskResponse(
        event.request,
        async () => Response.json({ data: { result } }, { status: status || 200, headers }),
        { watch: reg.watch ?? [] },
      )
    }

    if (result.ok) {
      if (result.outcome === 'not-applied') {
        return renderInlineWithResult(event, resolve, result, 200, setCookies)
      }
      const target = reg.redirectOnSuccess?.(event, result) ?? queuedData(result)?.statusUrl
      if (target === 'inline') {
        return renderInlineWithResult(event, resolve, result, 200, setCookies)
      }
      redirect(303, target ?? event.url.pathname + event.url.search)
    }

    return renderInlineWithResult(event, resolve, result, status, setCookies)
  }
}

export const componentFormsHandle: Handle = createComponentFormsHandle()
