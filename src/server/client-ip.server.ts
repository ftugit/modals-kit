// Доверенное извлечение клиентского IP, нормализация подсети (/24 IPv4, /48 IPv6)
// и общие скользящие ограничители частоты (`windowThrottle` поверх `sharedStore`).
import { isIP } from 'node:net'
import { windowThrottle, type Throttle } from '#lib/form/server.js'
import { sharedStore } from './cache.server.js'

export interface ClientAddressSource {
  readonly getClientAddress?: () => string
  readonly request?: Request
}

function extractMappedIpv4(lowerIpv6: string): string | null {
  const dotted = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(lowerIpv6)
  if (dotted?.[1] && isIP(dotted[1]) === 4) return dotted[1]
  const hexPair = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lowerIpv6)
  if (hexPair?.[1] && hexPair[2]) {
    const hi = parseInt(hexPair[1], 16)
    const lo = parseInt(hexPair[2], 16)
    const candidate = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`
    if (isIP(candidate) === 4) return candidate
  }
  return null
}

/**
 * Очистить и проверить строковый IP-адрес (`node:net` `isIP`), сняв скобки `[...]`,
 * идентификатор зоны `%eth0` и префикс `::ffff:` у IPv4-mapped IPv6.
 */
export function normalizeClientIp(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined
  const trimmed = raw.trim().replace(/^\[|\]$/g, '').split('%')[0]!.trim()
  if (!trimmed || trimmed.length > 64) return undefined
  const ver = isIP(trimmed)
  if (ver === 4) return trimmed
  if (ver === 6) {
    const lower = trimmed.toLowerCase()
    return extractMappedIpv4(lower) ?? lower
  }
  return undefined
}

function expandIpv6Hextets(ipv6: string): number[] | null {
  const lower = ipv6.toLowerCase()
  const halves = lower.split('::')
  if (halves.length > 2) return null

  const parsePart = (part: string): number[] | null => {
    if (!part) return []
    const tokens = part.split(':')
    const out: number[] = []
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i]!
      if (tok.includes('.')) {
        if (i !== tokens.length - 1 || isIP(tok) !== 4) return null
        const oct = tok.split('.').map(Number)
        out.push(((oct[0]! << 8) | oct[1]!) & 0xffff, ((oct[2]! << 8) | oct[3]!) & 0xffff)
      } else {
        if (!/^[0-9a-f]{1,4}$/.test(tok)) return null
        out.push(parseInt(tok, 16))
      }
    }
    return out
  }

  const left = parsePart(halves[0] ?? '')
  if (!left) return null
  if (halves.length === 1) {
    return left.length === 8 ? left : null
  }
  const right = parsePart(halves[1] ?? '')
  if (!right) return null
  const missing = 8 - (left.length + right.length)
  if (missing < 1) return null
  return [...left, ...new Array<number>(missing).fill(0), ...right]
}

/**
 * Преобразовать проверенный IP в каноническую подсеть `/24` (IPv4) или `/48` (IPv6).
 * Полный адрес отбрасывается.
 */
export function subnetFromIp(rawIp: string | null | undefined): string | undefined {
  const ip = normalizeClientIp(rawIp)
  if (!ip) return undefined
  if (isIP(ip) === 4) {
    const [a, b, c] = ip.split('.')
    return `${a}.${b}.${c}.0`
  }
  const hextets = expandIpv6Hextets(ip)
  if (!hextets) return undefined
  const h0 = hextets[0]!.toString(16)
  const h1 = hextets[1]!.toString(16)
  const h2 = hextets[2]!.toString(16)
  return `${h0}:${h1}:${h2}::`
}

/**
 * Извлечь доверенный IP клиента из `RequestEvent`:
 * - при наличии `event.getClientAddress` используется ТОЛЬКО он (клиентский
 *   `X-Forwarded-For` игнорируется, исключая спуфинг заголовка мимо прокси);
 * - фолбэк на `X-Forwarded-For` (со строгой проверкой `isIP`) допускается только
 *   в синтетических тестах, где `getClientAddress` не передан в объект события.
 */
export function clientIpOf(
  event?: ClientAddressSource | null,
  fallbackRequest?: Request,
): string | undefined {
  if (event && typeof event.getClientAddress === 'function') {
    try {
      const addr = normalizeClientIp(event.getClientAddress())
      if (addr) return addr
    } catch {
      // В пререндере или синтетических тестах адаптер может бросить при чтении сокета
    }
    return undefined
  }
  const req = event?.request ?? fallbackRequest
  if (!req) return undefined
  const xff = req.headers.get('x-forwarded-for')?.split(',')[0]
  return normalizeClientIp(xff)
}

/** Каноническая подсеть клиента из SvelteKit-события. */
export function subnetOfEvent(
  event?: ClientAddressSource | null,
  fallbackRequest?: Request,
): string | undefined {
  return subnetFromIp(clientIpOf(event, fallbackRequest))
}

/**
 * Создать скользящий ограничитель частоты по доверенному IP клиента поверх `sharedStore`.
 */
export function createIpThrottle<E extends ClientAddressSource = ClientAddressSource>(
  scopeName: string,
  limit: number,
  windowMs: number,
): Throttle<E> {
  const store = sharedStore.scope(`throttle:${scopeName}`, { max: 10_000 })
  return windowThrottle<E>({
    limit,
    windowMs,
    store,
    key: (req, event) => clientIpOf(event, req) ?? 'unknown',
  })
}
