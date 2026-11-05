import { describe, expect, it, vi } from 'vitest'
import type { RequestEvent } from '@sveltejs/kit'
import type { HandleFetch } from '@sveltejs/kit/hooks'

vi.mock('$app/env/private', () => ({ KIT_EDGE_PROXY_TOKEN: undefined }))
import { createEdgeClientAddressFetch, createEdgeClientAddressHandle } from './edge-client-address.server'
const edgeClientAddressFetch = createEdgeClientAddressFetch(() => SECRET)

const SECRET = 'A'.repeat(43) // deterministic test fixture, never a deployment secret
const BAD = 'B'.repeat(43)
const base = 'https://origin.example'

function event(headers: HeadersInit = {}, address = '192.0.2.9', request?: Request): RequestEvent {
  const req = request ?? new Request(`${base}/resource`, { headers })
  return { request: req, url: new URL(req.url), locals: {}, getClientAddress: () => address } as unknown as RequestEvent
}
async function apply(ev: RequestEvent, secret: string | undefined = SECRET): Promise<string> {
  const handle = createEdgeClientAddressHandle(() => secret)
  const response = await handle({ event: ev, resolve: async (resolved) => new Response(resolved.getClientAddress()) })
  return response.text()
}

describe('verified proxy identity on the framework RequestEvent', () => {
  it('overrides getClientAddress per request only when token and a single IP are valid', async () => {
    const a = event({ 'cdn-proxy-token': SECRET, 'cf-connecting-ip': '203.0.113.12', 'user-agent': 'browser/1', 'cdn-geo-region': '' })
    const b = event({ 'cdn-proxy-token': SECRET, 'cf-connecting-ip': '2001:db8::2', 'cdn-geo-region': 'DE-HE' }, '192.0.2.10')
    expect(await Promise.all([apply(a), apply(b)])).toEqual(['203.0.113.12', '2001:db8::2'])
    // Readonly original stays untouched; resolve receives the replacement.
    expect(a.getClientAddress()).toBe('192.0.2.9')
    expect(b.getClientAddress()).toBe('192.0.2.10')
    expect(a.locals.edge).toEqual({ userAgent: 'browser/1', geoRegion: undefined })
    expect(b.locals.edge).toEqual({ userAgent: undefined, geoRegion: 'DE-HE' })
  })

  it.each([
    ['no configured token', '', SECRET],
    ['no request token', SECRET, undefined],
    ['wrong token', SECRET, BAD],
    ['joined duplicate token', SECRET, `${SECRET}, ${SECRET}`],
    ['overlong token', SECRET, SECRET + 'x'],
  ])('%s leaves the adapter address and does not trust metadata', async (_name, configured, supplied) => {
    const headers = new Headers({ 'cf-connecting-ip': '203.0.113.8', 'user-agent': 'forged', 'x-real-ip': '203.0.113.7' })
    if (supplied) headers.set('cdn-proxy-token', supplied)
    const ev = event(headers)
    const original = ev.getClientAddress
    expect(await apply(ev, configured)).toBe('192.0.2.9')
    expect(ev.getClientAddress).toBe(original)
    expect(ev.locals.edge).toBeUndefined()
  })

  it.each(['', '203.0.113.8, 198.51.100.2', '203.0.113.8:1234', '[2001:db8::1]', 'fe80::1%eth0', '999.1.1.1'])('invalid or ambiguous IP %j keeps the adapter address', async (ip) => {
    const ev = event({ 'cdn-proxy-token': SECRET, 'cf-connecting-ip': ip })
    expect(await apply(ev)).toBe('192.0.2.9')
  })

  it('normalizes a verified IPv4-mapped address and bounds optional metadata', async () => {
    const ev = event({ 'cdn-proxy-token': SECRET, 'cf-connecting-ip': '::ffff:192.0.2.12', 'user-agent': 'x'.repeat(1025), 'cdn-geo-region': 'not/a/region' })
    expect(await apply(ev)).toBe('192.0.2.12')
    expect(ev.locals.edge).toEqual({ userAgent: undefined, geoRegion: undefined })
  })

  it('ignores lookalike legacy/custom IP headers even when the token is valid', async () => {
    const ev = event({ 'cdn-proxy-token': SECRET, 'cdn-client-ip': '203.0.113.90', 'x-real-ip': '203.0.113.91', 'x-forwarded-for': '203.0.113.92' })
    expect(await apply(ev)).toBe('192.0.2.9')
  })

  it('does not use raw Cloudflare country or an unverified custom geo field', async () => {
    const ev = event({ 'cf-connecting-ip': '203.0.113.93', 'cf-ipcountry': 'US', 'cdn-geo-region': 'US' })
    expect(await apply(ev)).toBe('192.0.2.9')
    expect(ev.locals.edge).toBeUndefined()
  })

  it('does not cross-contaminate simultaneous users', async () => {
    const events = Array.from({ length: 40 }, (_, i) => event({ 'cdn-proxy-token': SECRET, 'cf-connecting-ip': `198.51.100.${i + 1}` }))
    const addresses = await Promise.all(events.map((ev) => apply(ev)))
    expect(addresses).toEqual(events.map((_, i) => `198.51.100.${i + 1}`))
    expect(events.map((ev) => ev.getClientAddress())).toEqual(events.map(() => '192.0.2.9'))
  })

  it('preserves the verified framework address through same-origin event.fetch without forwarding secret headers', async () => {
    const parent = event({ 'cdn-proxy-token': SECRET, 'cf-connecting-ip': '203.0.113.44' })
    await apply(parent)
    const request = new Request(`${base}/internal`)
    const child = event({}, '192.0.2.9', request)
    const response = await edgeClientAddressFetch({
      event: parent,
      request,
      fetch: async (input) => {
        expect((input as Request).headers.has('cdn-proxy-token')).toBe(false)
        expect((input as Request).headers.has('cf-connecting-ip')).toBe(false)
        return new Response(await apply(child))
      },
    } as Parameters<HandleFetch>[0])
    expect(await response.text()).toBe('203.0.113.44')
    expect(child.getClientAddress()).toBe('192.0.2.9')
  })

  it('does not propagate identity to a different origin or trust forged internal metadata', async () => {
    const parent = event({ 'cdn-proxy-token': SECRET, 'cf-connecting-ip': '203.0.113.44' })
    await apply(parent)
    const request = new Request('https://other.example/internal')
    const child = event({}, '192.0.2.9', request)
    const response = await edgeClientAddressFetch({ event: parent, request, fetch: async () => new Response(await apply(child)) } as Parameters<HandleFetch>[0])
    expect(await response.text()).toBe('192.0.2.9')
  })

  it('rejects concurrent reuse of the same internal Request rather than mixing identities', async () => {
    const parent = event({ 'cdn-proxy-token': SECRET, 'cf-connecting-ip': '203.0.113.44' })
    await apply(parent)
    const request = new Request(`${base}/internal`)
    let release!: () => void
    const blocked = new Promise<void>((resolve) => { release = resolve })
    const args = { event: parent, request, fetch: async () => { await blocked; return new Response('ok') } } as Parameters<HandleFetch>[0]
    const first = edgeClientAddressFetch(args)
    await expect(edgeClientAddressFetch(args)).rejects.toThrow('Concurrent reuse')
    release()
    expect((await first).status).toBe(200)
  })
})
