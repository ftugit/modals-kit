// Единственная граница доверия к метаданным внешнего прокси. Проверяем токен до
// чтения/использования IP и применяем результат к штатному RequestEvent API.
// Заголовки нельзя считать доверенными самостоятельно вне этого модуля.
import { isIP } from 'node:net'
import type { Handle, HandleFetch } from '@sveltejs/kit/hooks'
import type { RequestEvent } from '@sveltejs/kit'
import { KIT_EDGE_PROXY_TOKEN } from '$app/env/private'
import { normalizeClientIp } from './ip-normalize.server.js'

const TOKEN_HEADER = 'cdn-proxy-token'
const IP_HEADER = 'cf-connecting-ip'
const UA_HEADER = 'user-agent'
const REGION_HEADER = 'cdn-geo-region'
const TOKEN_FORMAT = /^[A-Za-z0-9_-]{43}$/
const encoder = new TextEncoder()

type EdgeIdentity = { ip?: string; userAgent?: string; geoRegion?: string }
// SvelteKit внутренний event.fetch создаёт новый RequestEvent со старым
// адаптерным getClientAddress и не копирует наши заголовки. Связываем именно
// объект внутреннего Request с контекстом только на время handleFetch; никакой
// секрет/доверенный адрес не добавляется в сетевые заголовки.
// SvelteKit создаёт копии event для tracing, но locals остаётся одним и тем же.
const localsIdentities = new WeakMap<App.Locals, EdgeIdentity>()
const subrequestIdentities = new WeakMap<Request, EdgeIdentity | null>()

function applyIdentity(event: RequestEvent, identity: EdgeIdentity): RequestEvent {
  event.locals.edge = { userAgent: identity.userAgent, geoRegion: identity.geoRegion }
  localsIdentities.set(event.locals, identity)
  // getClientAddress — readonly в типах SvelteKit: передаём в resolve новый
  // RequestEvent с тем же locals/request и штатным API, не мутируя readonly.
  // Следующие Handle и маршруты видят этот event; event.fetch переносит его
  // идентичность отдельно через handleFetch.
  return identity.ip ? { ...event, getClientAddress: () => identity.ip! } : event
}

/**
 * WebCrypto работает в Node и Web-адаптерах. Сравниваем HMAC фиксированного
 * размера через verify, а не строковым сравнением с ранним выходом.
 */
async function tokenMatches(received: string | null, configured: string | undefined): Promise<boolean> {
  if (!configured || !TOKEN_FORMAT.test(configured) || !received || !TOKEN_FORMAT.test(received)) return false
  try {
    const key = await crypto.subtle.importKey('raw', encoder.encode(configured), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
    const suppliedMac = await crypto.subtle.sign('HMAC', key, encoder.encode(received))
    return await crypto.subtle.verify('HMAC', key, suppliedMac, encoder.encode(configured))
  } catch {
    // Нет crypto или ошибка реализации: недоверенные данные НЕ повышаются в доверии.
    return false
  }
}

function exactIp(raw: string | null): string | undefined {
  // Только один IP, без списка, порта, скобок или zone-id. Запятые при
  // объединении дублирующихся HTTP-заголовков тоже становятся невалидными.
  if (!raw || raw.length > 64 || raw !== raw.trim() || raw.includes('%') || isIP(raw) === 0) return undefined
  return normalizeClientIp(raw)
}

function safeUserAgent(raw: string | null): string | undefined {
  if (!raw || raw.length > 1024 || /[\u0000-\u001f\u007f]/.test(raw)) return undefined
  return raw
}

function safeRegion(raw: string | null): string | undefined {
  if (!raw || !/^[A-Za-z0-9_-]{1,64}$/.test(raw)) return undefined
  return raw
}

export function createEdgeClientAddressHandle(getSecret: () => string | undefined): Handle {
  return async ({ event: original, resolve }) => {
    let event = original
    // Дочернее event.fetch получает идентичность родителя по объекту Request,
    // а не из добавленного в сеть токена. Null означает непроверенный родитель.
    const inherited = subrequestIdentities.get(event.request)
    if (inherited) {
      event = applyIdentity(event, inherited)
    } else if (!subrequestIdentities.has(event.request)) {
      const headers = event.request.headers
      if (await tokenMatches(headers.get(TOKEN_HEADER), getSecret())) {
        event = applyIdentity(event, {
          ip: exactIp(headers.get(IP_HEADER)),
          userAgent: safeUserAgent(headers.get(UA_HEADER)),
          geoRegion: safeRegion(headers.get(REGION_HEADER)),
        })
      }
    }
    return resolve(event)
  }
}

/**
 * Контекст переносится ТОЛЬКО для same-origin event.fetch. Если одна и та же
 * Request одновременно переиспользована в двух запросах, отказываем вместо
 * потенциального смешивания идентичностей. Тело запроса не клонируем.
 */
export function createEdgeClientAddressFetch(getSecret: () => string | undefined): HandleFetch {
  return async ({ event, request, fetch }) => {
    if (!getSecret() || new URL(request.url).origin !== event.url.origin) return fetch(request)
    if (subrequestIdentities.has(request)) throw new Error('Concurrent reuse of an internal Request is not supported')
    subrequestIdentities.set(request, localsIdentities.get(event.locals) ?? null)
    try {
      return await fetch(request)
    } finally {
      subrequestIdentities.delete(request)
    }
  }
}

export const edgeClientAddressFetch = createEdgeClientAddressFetch(() => KIT_EDGE_PROXY_TOKEN)

/** Один и тот же Handle для adapter-node, Vercel и совместимых Web-адаптеров. */
export const edgeClientAddressHandle = createEdgeClientAddressHandle(() => KIT_EDGE_PROXY_TOKEN)
