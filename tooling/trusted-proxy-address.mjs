import { isIP } from 'node:net'

/**
 * Read ONLY the final X-Forwarded-For entry, and only after the caller has
 * verified the actual TCP peer against an operator-controlled allowlist.
 * This is safe as the immediate downstream address only if that peer is
 * known to append/overwrite XFF. A transparent proxy cannot establish trust.
 * Envoy's external-address header can survive internal hops and is ignored.
 * Missing/malformed XFF returns undefined so callers retain the peer address.
 */
export function trustedClientIp(headers) {
  const raw = headers['x-forwarded-for']
  const value = Array.isArray(raw) ? raw.join(',') : raw
  if (typeof value !== 'string' || !value.trim()) return undefined
  const last = value.split(',').at(-1)?.trim()
  return last && isIP(last) ? last : undefined
}
