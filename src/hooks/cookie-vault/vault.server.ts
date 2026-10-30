// Серверная криптография и регистрация форм универсального куки-сейфа.
//
// Архитектура хранения:
// - `dv_key` (`HttpOnly`) — одна кука-ключ браузера (32 случайных байта `base64url`).
//   При наличии `AUTH_SEAL_SECRET` эффективный 256-битный ключ выводится как
//   `SHA-256(rawCookieKey || ":" || AUTH_SEAL_SECRET)` — украденный профиль кук
//   невозможно расшифровать вне этого сервера; в dev без `.env` работает чистый `rawCookieKey`.
// - `dv_<scope>_<id>` (`HttpOnly`) — по одной зашифрованной `AES-256-GCM` куке на каждый
//   слот конфигурации с привязкой `AAD = "modals-kit:dv:v1:<scope>:<id>"`.
// - Удаление или перегенерация `dv_key` мгновенно обесценивает все куки конфигов разом.
import { AUTH_COOKIE_SAMESITE, AUTH_SEAL_SECRET } from '$app/env/private'
import { registerComponentForm } from '#hooks/component-form/registry.js'
import type { Cookies, RequestEvent } from '@sveltejs/kit'
import { VAULT_SLOT_ID_RE } from './schema.js'
import type {
  CookieVaultMaskedItem,
  CookieVaultSchema,
  CookieVaultSnapshot,
} from './types.js'

export const VAULT_MASTER_KEY_COOKIE = 'dv_key'
const VAULT_COOKIE_PREFIX = 'dv_'
const VAULT_MAX_COOKIE_CHARS = 3800
const VAULT_MAX_AGE_SECONDS = 60 * 60 * 24 * 30 // 30 суток
const GCM_IV_BYTES = 12
const KEY_BYTES = 32

interface StoredCipherEnvelope<TEntry> {
  readonly v: 1
  readonly updatedAt: string
  readonly entry: TEntry
}

function vaultCookieOpts(secureHttps = false) {
  return AUTH_COOKIE_SAMESITE === 'none'
    ? ({
        path: '/',
        httpOnly: true,
        sameSite: 'none',
        secure: true,
        partitioned: true,
        maxAge: VAULT_MAX_AGE_SECONDS,
      } as const)
    : ({
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: secureHttps,
        maxAge: VAULT_MAX_AGE_SECONDS,
      } as const)
}

function vaultDeleteOpts(secureHttps = false) {
  return AUTH_COOKIE_SAMESITE === 'none'
    ? ({ path: '/', httpOnly: true, sameSite: 'none', secure: true, partitioned: true } as const)
    : ({ path: '/', httpOnly: true, sameSite: 'lax', secure: secureHttps } as const)
}

const enc = new TextEncoder()
const dec = new TextDecoder()

export function slotCookieName(scope: string, id: string): string {
  return `${VAULT_COOKIE_PREFIX}${scope}_${id}`
}

function scopePrefix(scope: string): string {
  return `${VAULT_COOKIE_PREFIX}${scope}_`
}

function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url')
}

function fromBase64Url(raw: string): Uint8Array | null {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(raw)) return null
    return new Uint8Array(Buffer.from(raw, 'base64url'))
  } catch {
    return null
  }
}

async function deriveAesKey(rawCookieKey: Uint8Array): Promise<CryptoKey> {
  let keyMaterial: Uint8Array<ArrayBuffer>
  if (AUTH_SEAL_SECRET && AUTH_SEAL_SECRET.length >= 32) {
    const secretBytes = enc.encode(`:${AUTH_SEAL_SECRET}`)
    const combined = new Uint8Array(rawCookieKey.byteLength + secretBytes.byteLength)
    combined.set(rawCookieKey, 0)
    combined.set(secretBytes, rawCookieKey.byteLength)
    const digest = await crypto.subtle.digest('SHA-256', combined)
    keyMaterial = new Uint8Array(digest)
  } else {
    const copy = new Uint8Array(KEY_BYTES)
    copy.set(rawCookieKey.subarray(0, KEY_BYTES))
    keyMaterial = copy
  }

  return crypto.subtle.importKey(
    'raw',
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

function readRawMasterKey(cookies: Cookies): Uint8Array | null {
  const token = cookies.get(VAULT_MASTER_KEY_COOKIE)
  if (!token) return null
  const bytes = fromBase64Url(token)
  return bytes && bytes.byteLength === KEY_BYTES ? bytes : null
}

function ensureMasterKey(cookies: Cookies, secureHttps = false): Uint8Array {
  const existing = readRawMasterKey(cookies)
  if (existing) return existing
  const fresh = crypto.getRandomValues(new Uint8Array(KEY_BYTES))
  cookies.set(VAULT_MASTER_KEY_COOKIE, toBase64Url(fresh), vaultCookieOpts(secureHttps))
  return fresh
}

function aadBytes(scope: string, id: string): Uint8Array<ArrayBuffer> {
  const raw = enc.encode(`modals-kit:dv:v1:${scope}:${id}`)
  const out = new Uint8Array(raw.byteLength)
  out.set(raw)
  return out
}

async function encryptSlotValue<TEntry>(
  aesKey: CryptoKey,
  scope: string,
  id: string,
  payload: StoredCipherEnvelope<TEntry>,
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(GCM_IV_BYTES))
  const plain = enc.encode(JSON.stringify(payload))
  const plainBuf = new Uint8Array(plain.byteLength)
  plainBuf.set(plain)
  const cipherBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aadBytes(scope, id) },
    aesKey,
    plainBuf,
  )
  const cipher = new Uint8Array(cipherBuf)
  const packed = new Uint8Array(GCM_IV_BYTES + cipher.byteLength)
  packed.set(iv, 0)
  packed.set(cipher, GCM_IV_BYTES)
  return `v1.${toBase64Url(packed)}`
}

async function decryptSlotValue<TEntry>(
  aesKey: CryptoKey,
  scope: string,
  id: string,
  cookieValue: string,
): Promise<StoredCipherEnvelope<TEntry> | null> {
  if (!cookieValue.startsWith('v1.')) return null
  const packed = fromBase64Url(cookieValue.slice(3))
  if (!packed || packed.byteLength <= GCM_IV_BYTES + 16) return null
  const iv = new Uint8Array(GCM_IV_BYTES)
  iv.set(packed.subarray(0, GCM_IV_BYTES))
  const cipher = new Uint8Array(packed.byteLength - GCM_IV_BYTES)
  cipher.set(packed.subarray(GCM_IV_BYTES))

  try {
    const plainBuf = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: aadBytes(scope, id) },
      aesKey,
      cipher,
    )
    const parsed = JSON.parse(dec.decode(plainBuf)) as StoredCipherEnvelope<TEntry>
    if (!parsed || parsed.v !== 1 || typeof parsed.updatedAt !== 'string' || parsed.entry === undefined) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

/**
 * Прочитать и расшифровать все записи куки-сейфа для данного `scope` (только на сервере).
 * Битые или зашифрованные прежним ключом куки безопасно игнорируются.
 */
export async function readVaultEntries<TEntry, TMeta>(
  cookies: Cookies,
  schema: CookieVaultSchema<TEntry, TMeta>,
  inMemoryOverlay?: ReadonlyMap<string, StoredCipherEnvelope<TEntry> | null>,
): Promise<Map<string, { readonly entry: TEntry; readonly updatedAt: string }>> {
  const out = new Map<string, { readonly entry: TEntry; readonly updatedAt: string }>()
  const rawKey = readRawMasterKey(cookies)
  const prefix = scopePrefix(schema.scope)

  if (rawKey) {
    const aesKey = await deriveAesKey(rawKey)
    for (const c of cookies.getAll()) {
      if (!c.name.startsWith(prefix)) continue
      const id = c.name.slice(prefix.length)
      if (!VAULT_SLOT_ID_RE.test(id)) continue
      if (inMemoryOverlay?.has(id)) continue
      const env = await decryptSlotValue<TEntry>(aesKey, schema.scope, id, c.value)
      if (env) {
        out.set(id, { entry: env.entry, updatedAt: env.updatedAt })
      }
    }
  }

  if (inMemoryOverlay) {
    for (const [id, val] of inMemoryOverlay) {
      if (val === null) out.delete(id)
      else out.set(id, { entry: val.entry, updatedAt: val.updatedAt })
    }
  }

  return out
}

/**
 * Собрать безопасный публичный снимок сейфа (маскированный, без секретов) для `load` и ответа формы.
 */
export async function readVaultSnapshot<TEntry, TMeta>(
  cookies: Cookies,
  schema: CookieVaultSchema<TEntry, TMeta>,
  inMemoryOverlay?: ReadonlyMap<string, StoredCipherEnvelope<TEntry> | null>,
  overrideHasKey?: boolean,
): Promise<CookieVaultSnapshot<TMeta>> {
  const entries = await readVaultEntries(cookies, schema, inMemoryOverlay)
  const items: CookieVaultMaskedItem<TMeta>[] = []
  for (const [id, { entry, updatedAt }] of entries) {
    const masked = schema.mask(id, entry, updatedAt)
    items.push({
      id,
      label: masked.label,
      summary: masked.summary,
      meta: masked.meta,
      updatedAt,
    })
  }
  return {
    scope: schema.scope,
    hasKey: overrideHasKey ?? Boolean(readRawMasterKey(cookies)),
    maxEntries: schema.maxEntries,
    items,
  }
}

/**
 * Зашифровать и сохранить один слот конфига в `dv_<scope>_<id>` (при необходимости создаёт `dv_key`).
 */
export interface CookieVaultCookieWriteOptions {
  /** Запрос пришёл по `https:` — выставить флаг `Secure` даже при `SameSite=Lax`. */
  readonly secure?: boolean
}

export async function saveVaultEntry<TEntry, TMeta>(
  cookies: Cookies,
  schema: CookieVaultSchema<TEntry, TMeta>,
  id: string,
  entry: TEntry,
  cookieOptions?: CookieVaultCookieWriteOptions,
): Promise<
  | { readonly ok: true; readonly snapshot: CookieVaultSnapshot<TMeta> }
  | { readonly ok: false; readonly message: string }
> {
  if (!VAULT_SLOT_ID_RE.test(id)) {
    return {
      ok: false,
      message: `Недопустимый идентификатор слота «${id}» (латиница в нижнем регистре, цифры, «_», «-»)`,
    }
  }

  const current = await readVaultEntries(cookies, schema)
  if (!current.has(id) && current.size >= schema.maxEntries) {
    return {
      ok: false,
      message: `Достигнут лимит куки-сейфа (${schema.maxEntries} конфигов) — удалите ненужный слот перед добавлением нового`,
    }
  }

  const isHttps = Boolean(cookieOptions?.secure)
  const rawKey = ensureMasterKey(cookies, isHttps)
  const aesKey = await deriveAesKey(rawKey)
  const envelope: StoredCipherEnvelope<TEntry> = {
    v: 1,
    updatedAt: new Date().toISOString(),
    entry,
  }
  const encoded = await encryptSlotValue(aesKey, schema.scope, id, envelope)
  if (encoded.length > VAULT_MAX_COOKIE_CHARS) {
    return {
      ok: false,
      message: `Конфигурация слота превышает допустимый размер одной HTTP-куки (${VAULT_MAX_COOKIE_CHARS} байт)`,
    }
  }

  cookies.set(slotCookieName(schema.scope, id), encoded, vaultCookieOpts(isHttps))
  const overlay = new Map<string, StoredCipherEnvelope<TEntry> | null>([[id, envelope]])
  const snapshot = await readVaultSnapshot(cookies, schema, overlay, true)
  return { ok: true, snapshot }
}

/**
 * Удалить один слот конфига `dv_<scope>_<id>`.
 */
export async function removeVaultEntry<TEntry, TMeta>(
  cookies: Cookies,
  schema: CookieVaultSchema<TEntry, TMeta>,
  id: string,
  cookieOptions?: CookieVaultCookieWriteOptions,
): Promise<CookieVaultSnapshot<TMeta>> {
  const isHttps = Boolean(cookieOptions?.secure)
  if (VAULT_SLOT_ID_RE.test(id)) {
    cookies.delete(slotCookieName(schema.scope, id), vaultDeleteOpts(isHttps))
  }
  const overlay = new Map<string, StoredCipherEnvelope<TEntry> | null>([[id, null]])
  return readVaultSnapshot(cookies, schema, overlay)
}

/**
 * Сбросить куку-ключ `dv_key` и очистить все куки конфигов (мгновенное уничтожение секретов).
 */
export function resetVaultKey<TEntry, TMeta>(
  cookies: Cookies,
  schema: CookieVaultSchema<TEntry, TMeta>,
  cookieOptions?: CookieVaultCookieWriteOptions,
): CookieVaultSnapshot<TMeta> {
  const delOpts = vaultDeleteOpts(Boolean(cookieOptions?.secure))
  cookies.delete(VAULT_MASTER_KEY_COOKIE, delOpts)
  for (const c of cookies.getAll()) {
    if (c.name.startsWith(VAULT_COOKIE_PREFIX)) {
      cookies.delete(c.name, delOpts)
    }
  }
  return {
    scope: schema.scope,
    hasKey: false,
    maxEntries: schema.maxEntries,
    items: [],
  }
}

export type CookieVaultValidationResult =
  | { readonly ok: true }
  | {
      readonly ok: false
      readonly message: string
      readonly path?: readonly string[]
    }

export interface RegisterCookieVaultOptions<TEntry = unknown> {
  /** Маршрут редиректа при нативном HTTP POST без JS (по умолчанию сохраняет текущий путь + search). */
  redirectOnSuccess?: (event: RequestEvent) => string
  /** Скользящий ограничитель частоты для сохранения/проверки слота (`windowThrottle`). */
  throttle?: Parameters<typeof registerComponentForm>[0]['throttle']
  /** Серверная проверка конфига ПЕРЕД сохранением куки (например живая проверка доступности хранилища). */
  validateEntry?: (
    id: string,
    entry: TEntry,
    event: RequestEvent,
  ) => Promise<CookieVaultValidationResult> | CookieVaultValidationResult
  /** Хук после удаления слота (например очистка служебного кэша). */
  onRemoved?: (id: string, event: RequestEvent) => Promise<void> | void
  /** Хук после сброса ключа сейфа. */
  onReset?: (event: RequestEvent) => Promise<void> | void
}

function defaultRedirect(event: RequestEvent): string {
  return `${event.url.pathname}${event.url.search}`
}

/**
 * Зарегистрировать все 3 серверных обработчика форм экземпляра куки-сейфа
 * (`entryForm`, `deleteForm`, `resetKeyForm`) в глобальном `componentFormRegistry`.
 * Благодаря `componentFormsHandle` формы работают идентично и в модалке поверх любой страницы, и на отдельном роуте.
 */
export function registerCookieVaultForms<TEntry, TMeta>(
  schema: CookieVaultSchema<TEntry, TMeta>,
  options?: RegisterCookieVaultOptions<TEntry>,
): void {
  const redirect = options?.redirectOnSuccess ?? defaultRedirect
  const cookieOptsOf = (event: RequestEvent): CookieVaultCookieWriteOptions => ({
    secure: event.url.protocol === 'https:',
  })

  registerComponentForm({
    description: schema.entryForm,
    limits: { timeoutMs: 25_000 },
    ...(options?.throttle ? { throttle: options.throttle } : {}),
    async execute({ values, fail, commit }, event) {
      const parsed = schema.parse(values)
      if (!parsed.ok) {
        return fail([...parsed.issues], 'not-applied')
      }
      if (options?.validateEntry) {
        const verdict = await options.validateEntry(parsed.id, parsed.entry, event)
        if (!verdict.ok) {
          return fail(
            [
              {
                message: verdict.message,
                ...(verdict.path ? { path: [...verdict.path] } : {}),
                origin: 'server',
              },
            ],
            'not-applied',
          )
        }
      }
      const saved = await saveVaultEntry(event.cookies, schema, parsed.id, parsed.entry, cookieOptsOf(event))
      if (!saved.ok) {
        return fail([{ message: saved.message, origin: 'server' }], 'not-applied')
      }
      commit()
      return { data: { snapshot: saved.snapshot } }
    },
    redirectOnSuccess: redirect,
  })

  registerComponentForm({
    description: schema.deleteForm,
    async execute({ values, commit }, event) {
      const id = String(values.slot_id ?? '').trim()
      const snapshot = await removeVaultEntry(event.cookies, schema, id, cookieOptsOf(event))
      await options?.onRemoved?.(id, event)
      commit()
      return { data: { snapshot, removedId: id } }
    },
    redirectOnSuccess: redirect,
  })

  registerComponentForm({
    description: schema.resetKeyForm,
    async execute({ commit }, event) {
      const snapshot = resetVaultKey(event.cookies, schema, cookieOptsOf(event))
      await options?.onReset?.(event)
      commit()
      return { data: { snapshot } }
    },
    redirectOnSuccess: redirect,
  })
}
