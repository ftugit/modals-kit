import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'

// Route is installed only with the demo module. Never reflect proxy tokens,
// cookies or credentials: anyone can call a public diagnostic endpoint through
// the proxy and otherwise obtain the token that authenticates that proxy.
const SENSITIVE_HEADER = /authorization|cookie|token|secret|api[-_]?key|password|passwd|credential|session|signature/i

export const GET: RequestHandler = (event) => {
  const headers: Record<string, string> = {}
  for (const [name, value] of event.request.headers) {
    headers[name] = SENSITIVE_HEADER.test(name) ? '[redacted]' : value
  }

  return json(
    { ip: event.getClientAddress(), headers },
    { headers: { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } },
  )
}
