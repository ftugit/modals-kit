/**
 * F8: транспорты к внешним API берут `fetch`, запомненный в `init` сервера,
 * а не текущий глобальный (в dev его на время SSR-рендера подменяет Kit).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { fetchGraphql, resetGraphqlTransport } from './graphql'
import { fetchShikimoriJson, resetShikimoriTransport } from './shikimori'
import { captureUpstreamFetch, upstreamFetch } from './upstream'

const original = globalThis.fetch
const ok = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })

afterEach(() => {
  globalThis.fetch = original
  captureUpstreamFetch(original)
  resetGraphqlTransport()
  resetShikimoriTransport()
})

describe('fetch для внешних API', () => {
  it('без init — глобальный fetch в момент вызова', () => {
    captureUpstreamFetch(original)
    expect(upstreamFetch()).toBe(original)
  })

  it('после init подмена глобального fetch (обёртка рендера) транспорты не задевает', async () => {
    const calls: string[] = []
    captureUpstreamFetch((async (url: string | URL) => {
      calls.push(`native ${String(url)}`)
      return String(url).includes('graphql') ? ok({ data: { x: 1 } }) : ok([])
    }) as typeof globalThis.fetch)
    // Kit в dev на время SSR-рендера ставит свою обёртку — её звать нельзя.
    globalThis.fetch = (async () => {
      throw new Error('вызвана обёртка рендера')
    }) as typeof globalThis.fetch

    await fetchGraphql({ url: 'https://example.test/graphql', doc: '{ x }', map: (d) => d })
    await fetchShikimoriJson('/studios', { minGapMs: 0 })
    expect(calls).toHaveLength(2)
    expect(calls.every((c) => c.startsWith('native '))).toBe(true)
  })
})
