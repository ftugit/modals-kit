// Серверный контур встраиваемых форм компонентов (`src/hooks/component-form`).
//
// Связка `#lib/form` × SvelteKit `Handle`: компонент со своей формой может
// монтироваться на любой странице или в модалке поверх любого маршрута, у
// которого нет собственного `+page.server.ts` с `actions` (а если есть — чужие
// POST без зарегистрированного `__form_id` передаются в `resolve` с целым телом).
//
// Механика без двойной буферизации `request.clone()` и без заливки файлов в RAM:
//   - при `x-form-id` ранний гейт `preAuthorize(event)` / `authorize(event)`
//     выполняется ДО чтения тела (`0` прочитанных байт в RAM, поток отменяется);
//   - потолок чтения HTTP POST сужается до реального бюджета конкретной формы
//     (`min(FORM_BODY_LIMIT, reg.limits.budget, desc.limits.budget)`, а для чисто
//     текстовых форм без файловых полей — не выше `64 КиБ`);
//   - без `x-form-id` во время чтения первых `32 КиБ` (`PREFIX_SCAN_CAP`) поток
//     сверяет `__form_id`: любые `multipart/form-data` с непустым файлом
//     (`filename="..."`) без зарегистрированной файловой формы или сверх бюджета
//     отменяются на лету через `reader.cancel()` без сборки `FormData`/`File` в ОЗУ.
import { redirect, type RequestEvent } from '@sveltejs/kit'
import type { Handle } from '@sveltejs/kit/hooks'
import { taskResponse } from '#hooks/task-stream.server.js'
import { createFormHandler } from '#lib/form/server.js'
import {
  buildEnvelope,
  queuedData,
  type FormDescription,
  type Result,
} from '#lib/form/index.js'
import { bodyBudget, envLimits } from '#server/form-budget.server.js'
import { SECURITY_LAYERS } from '#server/form-security.server.js'
import {
  createAuthorizeGuards,
  hasAuthVerdictError,
  runPreAuthorize,
} from './authorize.server.js'
import { componentFormRegistry, registerComponentForm } from './registry.js'
import { FORM_ID_HEADER } from './transport.js'
import type { ComponentFormAuthVerdict, ComponentFormRegistration } from './types.js'

export { registerComponentForm }

/** Параметры опроса задачи: адрес формы + `__form_id` называют регистрацию. */
const TASK_PARAM = '__form_task'
const FORM_PARAM = '__form_id'
const NO_STORE = { 'cache-control': 'no-store' } as const
/** Предел чтения префикса для извлечения `__form_id` при чтении потока без `x-form-id`. */
const PREFIX_SCAN_CAP = 32 * 1024
/** Потолок тела HTTP POST для чисто текстовых форм без объявленного `budget`. */
const TEXT_ONLY_FORM_HTTP_CAP = 64 * 1024
/** Потолок сквозного POST без зарегистрированного `__form_id` (экшены маршрутов). */
const UNMATCHED_POST_CAP = 32 * 1024
/** Признак непустой файловой части в заголовках `multipart/form-data` (`filename="foo.ext"`). */
const MULTIPART_FILE_PART_RE = /content-disposition:\s*form-data;[^\r\n]*\bfilename="[^"]+"/i

const isJsonRequest = (request: Request): boolean =>
  (request.headers.get('accept') ?? '').includes('application/json')

const isFormBody = (request: Request): boolean => {
  const ct = (request.headers.get('content-type') ?? '').toLowerCase()
  return ct.includes('application/x-www-form-urlencoded') || ct.includes('multipart/form-data')
}

function resolveDescription(reg: ComponentFormRegistration, event: RequestEvent): FormDescription {
  return typeof reg.description === 'function' ? reg.description(event) : reg.description
}

function formAcceptsFiles(reg: ComponentFormRegistration, event: RequestEvent): boolean {
  const desc = resolveDescription(reg, event)
  if (desc.limits.fileFields.length > 0) return true
  for (const field of desc.fields) {
    if (field.fieldSet?.kinds && 'file' in field.fieldSet.kinds) return true
  }
  return false
}

function resolveFormHttpBudget(
  reg: ComponentFormRegistration,
  event: RequestEvent,
  envCap: number,
): number {
  const desc = resolveDescription(reg, event)
  const regBudget = reg.limits?.budget
  const descBudget = desc.limits.budget ?? undefined
  if (regBudget !== undefined || descBudget !== undefined) {
    return Math.min(regBudget ?? envCap, descBudget ?? envCap, envCap)
  }
  if (!formAcceptsFiles(reg, event)) {
    return Math.min(envCap, TEXT_ONLY_FORM_HTTP_CAP)
  }
  return envCap
}

function resolveRegistryHttpCap(
  registry: ReadonlyMap<string, ComponentFormRegistration>,
  event: RequestEvent,
  envCap: number,
): number {
  let maxFormCap = Math.min(envCap, UNMATCHED_POST_CAP)
  for (const [, entry] of registry) {
    const cap = resolveFormHttpBudget(entry, event, envCap)
    if (cap > maxFormCap) maxFormCap = cap
  }
  return Math.min(envCap, maxFormCap)
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
 * запрос без заголовка `x-form-id` читается из потока.
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

type PreVerdictState = { readonly checked: boolean; readonly verdict: ComponentFormAuthVerdict }

type InspectedBody =
  | {
      kind: 'ok'
      bytes: Uint8Array<ArrayBuffer>
      formData: FormData | null
      matched?: ComponentFormRegistration
      preVerdict?: PreVerdictState
    }
  | {
      kind: 'too-large'
      prefix: Uint8Array<ArrayBuffer>
      truncated: boolean
      matched?: ComponentFormRegistration
      effectiveCap: number
    }
  | {
      kind: 'pre-rejected'
      matched: ComponentFormRegistration
      preVerdict: PreVerdictState
    }
  | { kind: 'unreadable' }

interface ReadBoundedOptions {
  readonly request: Request
  readonly event: RequestEvent
  readonly trackedEvent: RequestEvent
  readonly registry: ReadonlyMap<string, ComponentFormRegistration>
  readonly initialMatched: ComponentFormRegistration | undefined
  readonly envCap: number
}

/**
 * Однопроходное чтение тела без `request.clone()` с динамическим потолком RAM:
 * - опознаёт `__form_id` на лету в первых `32 КиБ` (`PREFIX_SCAN_CAP`) и тут же
 *   сужает лимит до бюджета конкретной формы + запускает `runPreAuthorize`;
 * - мгновенно отменяет поток (`reader.cancel()`), если в `multipart/form-data`
 *   обнаружена файловая часть (`filename="..."`) для незарегистрированной или
 *   чисто текстовой формы, либо без `__form_id` сверх `UNMATCHED_POST_CAP`.
 */
async function readBoundedOnce(opts: ReadBoundedOptions): Promise<InspectedBody> {
  const { request, event, trackedEvent, registry, envCap } = opts
  let matched = opts.initialMatched
  let preVerdict: PreVerdictState | undefined

  const contentType = (request.headers.get('content-type') ?? '').toLowerCase()
  const isMultipart = contentType.includes('multipart/form-data')

  let activeCap = matched
    ? resolveFormHttpBudget(matched, event, envCap)
    : resolveRegistryHttpCap(registry, event, envCap)

  const declared = Number(request.headers.get('content-length') ?? 0)
  let declaredOversized = Number.isFinite(declared) && declared > activeCap

  if (!request.body) {
    if (declaredOversized) {
      return {
        kind: 'too-large',
        prefix: new Uint8Array(new ArrayBuffer(0)),
        truncated: false,
        matched,
        effectiveCap: activeCap,
      }
    }
    const empty = new Uint8Array(new ArrayBuffer(0))
    const formData = await new Request(request.url, {
      method: request.method,
      headers: request.headers,
      body: empty,
    })
      .formData()
      .catch(() => null)
    return { kind: 'ok', bytes: empty, formData, matched, preVerdict }
  }

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  const prefixChunks: Uint8Array[] = []
  let seen = 0
  let prefixSeen = 0
  let fileGuardCheckedOnMatched = matched ? !formAcceptsFiles(matched, event) : true

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      const prevPrefixSeen = prefixSeen
      if (prefixSeen < PREFIX_SCAN_CAP) {
        const take = Math.min(value.byteLength, PREFIX_SCAN_CAP - prefixSeen)
        prefixChunks.push(take === value.byteLength ? value : value.subarray(0, take))
        prefixSeen += take
      }

      seen += value.byteLength
      const prefixGrew = prefixSeen > prevPrefixSeen

      if (!matched && prefixGrew) {
        const currentPrefix = mergeChunks(prefixChunks, prefixSeen)
        const found = matchFromPrefix(registry, event, currentPrefix, true)
        if (found) {
          matched = found
          activeCap = resolveFormHttpBudget(matched, event, envCap)
          if (Number.isFinite(declared) && declared > activeCap) {
            declaredOversized = true
          }
          fileGuardCheckedOnMatched = !formAcceptsFiles(matched, event)
          preVerdict = await runPreAuthorize(matched, trackedEvent)
          if (hasAuthVerdictError(preVerdict.verdict)) {
            await reader.cancel().catch(() => undefined)
            return { kind: 'pre-rejected', matched, preVerdict }
          }
        }
      }

      // Пресекаем протаскивание файлов (`filename="..."`) мимо зарегистрированных файловых форм.
      if (isMultipart && fileGuardCheckedOnMatched && prefixGrew) {
        const prefixText = new TextDecoder('utf-8', { fatal: false }).decode(
          mergeChunks(prefixChunks, prefixSeen),
        )
        if (MULTIPART_FILE_PART_RE.test(prefixText)) {
          await reader.cancel().catch(() => undefined)
          return {
            kind: 'too-large',
            prefix: mergeChunks(prefixChunks, prefixSeen),
            truncated: true,
            matched,
            effectiveCap: activeCap,
          }
        }
      }

      // Неопознанный POST без `__form_id` не может расти сверх `UNMATCHED_POST_CAP` (32 КиБ).
      const unmatchedCap = Math.min(activeCap, UNMATCHED_POST_CAP)
      if (!matched && seen > unmatchedCap) {
        await reader.cancel().catch(() => undefined)
        return {
          kind: 'too-large',
          prefix: mergeChunks(prefixChunks, prefixSeen),
          truncated: true,
          matched: undefined,
          effectiveCap: unmatchedCap,
        }
      }

      if (declaredOversized) {
        if (matched || prefixSeen >= PREFIX_SCAN_CAP) {
          await reader.cancel().catch(() => undefined)
          return {
            kind: 'too-large',
            prefix: mergeChunks(prefixChunks, prefixSeen),
            truncated: true,
            matched,
            effectiveCap: activeCap,
          }
        }
        continue
      }

      if (seen > activeCap) {
        await reader.cancel().catch(() => undefined)
        return {
          kind: 'too-large',
          prefix: mergeChunks(prefixChunks, prefixSeen),
          truncated: true,
          matched,
          effectiveCap: activeCap,
        }
      }

      chunks.push(value)
    }
  } catch {
    return { kind: 'unreadable' }
  }

  // Финальная попытка опознать маленькое тело (< 32 КиБ), где последний `--` пришёл в конце потока.
  if (!matched && prefixSeen > 0) {
    const fullPrefix = mergeChunks(prefixChunks, prefixSeen)
    const found = matchFromPrefix(registry, event, fullPrefix, false)
    if (found) {
      matched = found
      activeCap = resolveFormHttpBudget(matched, event, envCap)
      if (seen > activeCap || (isMultipart && !formAcceptsFiles(matched, event) && MULTIPART_FILE_PART_RE.test(new TextDecoder('utf-8', { fatal: false }).decode(fullPrefix)))) {
        return {
          kind: 'too-large',
          prefix: fullPrefix,
          truncated: false,
          matched,
          effectiveCap: activeCap,
        }
      }
      preVerdict = await runPreAuthorize(matched, trackedEvent)
      if (hasAuthVerdictError(preVerdict.verdict)) {
        return { kind: 'pre-rejected', matched, preVerdict }
      }
    } else if (isMultipart && MULTIPART_FILE_PART_RE.test(new TextDecoder('utf-8', { fatal: false }).decode(fullPrefix))) {
      return {
        kind: 'too-large',
        prefix: fullPrefix,
        truncated: false,
        matched: undefined,
        effectiveCap: Math.min(activeCap, UNMATCHED_POST_CAP),
      }
    }
  }

  if (declaredOversized || seen > activeCap) {
    return {
      kind: 'too-large',
      prefix: mergeChunks(prefixChunks, prefixSeen),
      truncated: false,
      matched,
      effectiveCap: activeCap,
    }
  }

  const bytes = mergeChunks(chunks, seen)
  const formData = await new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body: bytes,
  })
    .formData()
    .catch(() => null)
  return { kind: 'ok', bytes, formData, matched, preVerdict }
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

/**
 * Собрать лёгкий синтетический запрос без тела клиента, когда `preAuthorize`
 * отказал на `0` байтах файла: сохраняет проверку `originGuard`, идентификатор
 * формы и выдаёт штатный `Result` (`403` / `422`).
 */
function makePreRejectedAuthRequest(original: Request, desc: FormDescription): Request {
  const env = buildEnvelope(
    {
      formId: desc.id,
      revision: desc.revision,
      instance: `${desc.id}:new`,
      submissionId: '00000000-0000-4000-8000-000000000000',
    },
    desc.policy,
  )
  const params = new URLSearchParams(env)
  params.set(desc.policy.envelopeKeys.intent, desc.actions[0]?.id ?? 'submit')

  const headers = new Headers()
  for (const name of ['origin', 'referer', 'accept', 'cookie', 'accept-language']) {
    const val = original.headers.get(name)
    if (val) headers.set(name, val)
  }
  headers.set('content-type', 'application/x-www-form-urlencoded;charset=UTF-8')

  return new Request(original.url, {
    method: 'POST',
    headers,
    body: params.toString(),
  })
}

function stripFieldValidatorsForPreReject(desc: FormDescription): FormDescription {
  return {
    ...desc,
    fields: [],
    byName: {},
  }
}

function createTrackedEvent(event: RequestEvent): {
  readonly trackedEvent: RequestEvent
  readonly setCookies: Map<string, string>
} {
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
  return {
    trackedEvent: { ...event, cookies: trackedCookies },
    setCookies,
  }
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

    const envCap = bodyBudget()
    const { trackedEvent, setCookies } = createTrackedEvent(event)
    const headerFormId = event.request.headers.get(FORM_ID_HEADER)?.trim() ?? ''
    const headerMatched = headerFormId ? registry.get(headerFormId) : undefined

    let matched: ComponentFormRegistration | undefined = headerMatched
    let raw: FormData = new FormData()
    let handlerRequest: Request = event.request
    let isOversizedBeforeParse = false
    let isPreRejected = false
    let preVerdict: PreVerdictState | undefined

    if (matched) {
      preVerdict = await runPreAuthorize(matched, trackedEvent)
      if (hasAuthVerdictError(preVerdict.verdict)) {
        await event.request.body?.cancel().catch(() => undefined)
        isPreRejected = true
      }
    }

    const initialFormCap = matched ? resolveFormHttpBudget(matched, event, envCap) : envCap
    const declared = Number(event.request.headers.get('content-length') ?? 0)
    const declaredOversized = Number.isFinite(declared) && declared > initialFormCap

    const isMultipartRequest = (event.request.headers.get('content-type') ?? '')
      .toLowerCase()
      .includes('multipart/form-data')
    const requiresStreamFileScan =
      matched !== undefined && isMultipartRequest && !formAcceptsFiles(matched, event)

    if (isPreRejected && matched) {
      const desc = resolveDescription(matched, event)
      handlerRequest = makePreRejectedAuthRequest(event.request, desc)
    } else if (matched && ((!needsRawFormData(matched) && !requiresStreamFileScan) || declaredOversized)) {
      // Быстрый путь: JS-транспорт прислал `x-form-id`, и форме не нужен предразбор
      // `raw` до `createFormHandler` (либо `Content-Length` уже превышает её потолок) —
      // передаём поток напрямую в `bodyLayer` с потолком конкретной формы.
      if (declaredOversized) {
        await event.request.body?.cancel().catch(() => undefined)
        handlerRequest = makeOversizedMarkerRequest(event.request, initialFormCap)
      }
      isOversizedBeforeParse = declaredOversized
    } else {
      const inspected = await readBoundedOnce({
        request: event.request,
        event,
        trackedEvent,
        registry,
        initialMatched: matched,
        envCap,
      })
      if (inspected.kind === 'unreadable') {
        return Response.json({ code: 'body.unreadable', message: 'Unreadable request body' }, { status: 400 })
      }

      if (inspected.kind === 'pre-rejected') {
        matched = inspected.matched
        preVerdict = inspected.preVerdict
        isPreRejected = true
        const desc = resolveDescription(matched, event)
        handlerRequest = makePreRejectedAuthRequest(event.request, desc)
      } else if (inspected.kind === 'too-large') {
        matched =
          inspected.matched ??
          matched ??
          matchFromPrefix(registry, event, inspected.prefix, inspected.truncated)
        if (!matched || (!formAcceptsFiles(matched, event) && MULTIPART_FILE_PART_RE.test(new TextDecoder('utf-8', { fatal: false }).decode(inspected.prefix)))) {
          return isJsonRequest(event.request)
            ? Response.json({ code: 'body.too-large', message: 'Request body too large' }, { status: 413 })
            : new Response('Request body too large', { status: 413 })
        }
        isOversizedBeforeParse = true
        handlerRequest = makeOversizedMarkerRequest(event.request, inspected.effectiveCap)
      } else {
        matched = inspected.matched ?? matched
        preVerdict = inspected.preVerdict ?? preVerdict
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
        const matchedCap = resolveFormHttpBudget(matched, event, envCap)
        if (inspected.bytes.byteLength > matchedCap) {
          isOversizedBeforeParse = true
          handlerRequest = makeOversizedMarkerRequest(event.request, matchedCap)
        } else {
          handlerRequest = replay()
        }
      }
    }

    const reg = matched
    const baseDescription = resolveDescription(reg, event)
    const description = isPreRejected
      ? stripFieldValidatorsForPreReject(baseDescription)
      : baseDescription
    const formBudget = resolveFormHttpBudget(reg, event, envCap)
    const skipPreLoad = isOversizedBeforeParse || isPreRejected
    const resolvedChecks =
      !skipPreLoad && typeof reg.checks === 'function'
        ? await reg.checks(trackedEvent)
        : typeof reg.checks !== 'function'
          ? reg.checks
          : undefined
    const resolvedSource =
      !skipPreLoad && typeof reg.source === 'function'
        ? await reg.source(trackedEvent, raw)
        : typeof reg.source === 'object'
          ? reg.source
          : undefined
    const authGuards = createAuthorizeGuards(reg, trackedEvent, () => raw, { preVerdict })

    const handler = createFormHandler<unknown, RequestEvent>({
      description,
      order: authGuards.layer ? [...SECURITY_LAYERS, authGuards.layer] : SECURITY_LAYERS,
      ...(resolvedSource ? { source: resolvedSource } : {}),
      ...(authGuards.schema ? { schema: authGuards.schema } : {}),
      ...(resolvedChecks ? { checks: resolvedChecks } : {}),
      limits: envLimits({ ...(reg.limits ?? {}), budget: formBudget }),
      ...(reg.idempotency ? { idempotency: reg.idempotency } : {}),
      ...(reg.throttle ? { throttle: reg.throttle } : {}),
      ...(reg.prepare && !isPreRejected ? { prepare: reg.prepare } : {}),
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
