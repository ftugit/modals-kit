// Чистая проверка IP, без подключения хранилища и БД.
import { isIP } from 'node:net'

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
