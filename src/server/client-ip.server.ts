// Доверенное извлечение клиентского IP, нормализация подсети (/24 IPv4, /48 IPv6)
// и общие скользящие ограничители частоты (`windowThrottle` поверх `sharedStore`).
import { isIP } from 'node:net'
import { windowThrottle, type Throttle } from '#lib/form/server.js'
import { sharedStore } from './cache.server.js'
import { normalizeClientIp } from './ip-normalize.server.js'
export { normalizeClientIp } from './ip-normalize.server.js'

export interface ClientAddressSource {
  readonly getClientAddress?: () => string
  readonly request?: Request
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
 * - без адаптерного `getClientAddress` доверенного адреса нет: заголовки
 *   запроса не становятся доверенными даже в синтетических событиях.
 */
export function clientIpOf(
  event?: ClientAddressSource | null,
  _fallbackRequest?: Request,
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
  return undefined
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
