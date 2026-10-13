/**
 * #lib/fetch: таймаут, свой signal, повторы, Retry-After, лимиты хоста, склейка.
 * Часы виртуальные: `sleep` двигает время мгновенно, поэтому паузы проверяются
 * точными числами, а тесты не ждут настоящих секунд.
 */
import { describe, expect, it } from 'vitest'
import { createFetch, ensureOk, FetchError, isAbortError, readJson, retryAfter, type FetchClock } from './index'

function virtualClock(start = 1_000_000) {
  let t = start
  const sleeps: number[] = []
  const clock: FetchClock = {
    now: () => t,
    random: () => 1,
    sleep: async (ms, signal) => {
      signal?.throwIfAborted()
      sleeps.push(ms)
      t += ms
      await Promise.resolve()
      signal?.throwIfAborted()
    },
  }
  return { clock, sleeps, now: () => t }
}

type Call = { url: string; init: RequestInit; at: number }

function stub(answer: (n: number, call: Call) => Response | Promise<Response>, now: () => number = () => 0) {
  const calls: Call[] = []
  const fetch = async (input: string | URL | Request, init: RequestInit = {}) => {
    const call = { url: String(input instanceof Request ? input.url : input), init, at: now() }
    calls.push(call)
    return await answer(calls.length, call)
  }
  return { fetch, calls }
}

const json = (value: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', ...headers } })

describe('повторы', () => {
  it('503 → пауза по экспоненте → успех; тело брошенного ответа отпущено', async () => {
    const v = virtualClock()
    const s = stub((n) => (n < 3 ? json({ n }, 503) : json({ ok: true })))
    const f = createFetch({ fetch: s.fetch, clock: v.clock, retry: { baseDelayMs: 100 } })
    const res = await f('https://a.test/x')
    expect(await res.json()).toEqual({ ok: true })
    expect(s.calls).toHaveLength(3)
    expect(v.sleeps).toEqual([100, 200]) // random() = 1 → потолок jitter
  })

  it('попытки кончились → последний ответ как есть (fetch-совместимо), readJson даёт fetch.status', async () => {
    const v = virtualClock()
    const s = stub(() => json({}, 502))
    const f = createFetch({ fetch: s.fetch, clock: v.clock, retry: { attempts: 2 } })
    const res = await f('https://a.test/x')
    expect(res.status).toBe(502)
    expect(s.calls).toHaveLength(2)
    const error = await readJson(res).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(FetchError)
    expect(error).toMatchObject({ code: 'fetch.status', status: 502, upstreamStatus: 502 })
  })

  it('4xx (кроме 408/425/429) не повторяется', async () => {
    const s = stub(() => json({}, 404))
    const f = createFetch({ fetch: s.fetch, clock: virtualClock().clock })
    expect((await f('https://a.test/x')).status).toBe(404)
    expect(s.calls).toHaveLength(1)
  })

  it('POST не повторяется, пока вызов не скажет idempotent', async () => {
    const s = stub(() => json({}, 503))
    const f = createFetch({ fetch: s.fetch, clock: virtualClock().clock })
    await f('https://a.test/x', { method: 'POST', body: '{}' })
    expect(s.calls).toHaveLength(1)
    await f('https://a.test/x', { method: 'POST', body: '{}', idempotent: true })
    expect(s.calls).toHaveLength(4)
  })

  it('сетевой сбой повторяется; после всех попыток — FetchError fetch.network, адрес только в cause', async () => {
    const s = stub(() => {
      throw new TypeError('fetch failed')
    })
    const f = createFetch({ fetch: s.fetch, clock: virtualClock().clock })
    const error = (await f('https://secret.test/x?token=1').catch((e: unknown) => e)) as FetchError
    expect(s.calls).toHaveLength(3)
    expect(error).toMatchObject({ name: 'FetchError', code: 'fetch.network', status: 504 })
    expect(error.message).not.toContain('secret')
    expect(JSON.stringify(error.cause)).toContain('secret.test')
  })

  it('retry: false и attempts: 1 выключают повторы', async () => {
    const s = stub(() => json({}, 503))
    await createFetch({ fetch: s.fetch, retry: false })('https://a.test/x')
    await createFetch({ fetch: s.fetch })('https://a.test/x', { retry: { attempts: 1 } })
    expect(s.calls).toHaveLength(2)
  })
})

describe('Retry-After', () => {
  it('секунды и HTTP-дата разбираются; кривое значение — null', () => {
    const now = Date.parse('2026-10-13T10:00:00Z')
    const r = (v: string) => new Response(null, { status: 429, headers: { 'retry-after': v } })
    expect(retryAfter(r('2'), now)).toBe(2_000)
    expect(retryAfter(r('Tue, 13 Oct 2026 10:00:03 GMT'), now)).toBe(3_000)
    expect(retryAfter(r('soon'), now)).toBeNull()
    expect(retryAfter(r('-1'), now)).toBeNull()
  })

  it('пауза берётся из Retry-After, а не из экспоненты', async () => {
    const v = virtualClock()
    const s = stub((n) => (n === 1 ? json({}, 429, { 'retry-after': '2' }) : json({ ok: 1 })))
    const f = createFetch({ fetch: s.fetch, clock: v.clock })
    expect((await f('https://a.test/x')).status).toBe(200)
    expect(v.sleeps).toEqual([2_000])
  })

  it('просьба ждать дольше потолка → без повтора, ответ 429 как есть', async () => {
    const v = virtualClock()
    const s = stub(() => json({}, 429, { 'retry-after': '60' }))
    const f = createFetch({ fetch: s.fetch, clock: v.clock, retry: { maxDelayMs: 5_000 } })
    expect((await f('https://a.test/x')).status).toBe(429)
    expect(s.calls).toHaveLength(1)
  })

  it('429 с Retry-After ставит паузу всему хосту: следующий запрос ждёт её', async () => {
    const v = virtualClock()
    const s = stub((n) => (n === 1 ? json({}, 429, { 'retry-after': '30' }) : json({})), v.now)
    const f = createFetch({ fetch: s.fetch, clock: v.clock, retry: false, hosts: { 'a.test': {} } })
    const t0 = v.now()
    await f('https://a.test/1')
    await f('https://a.test/2')
    expect(s.calls[1]!.at - t0).toBe(30_000)
  })
})

describe('таймаут и signal', () => {
  const hanging = (_input: string | URL | Request, init: RequestInit = {}) =>
    new Promise<Response>((_, reject) => {
      init.signal?.addEventListener('abort', () => reject(init.signal!.reason), { once: true })
    })

  it('таймаут попытки → повтор → FetchError fetch.timeout (504)', async () => {
    let calls = 0
    const f = createFetch({
      fetch: (i, init) => ((calls += 1), hanging(i, init)),
      timeoutMs: 10,
      clock: virtualClock().clock,
      retry: { attempts: 2 },
    })
    const error = await f('https://a.test/x').catch((e: unknown) => e)
    expect(calls).toBe(2)
    expect(error).toMatchObject({ code: 'fetch.timeout', status: 504 })
  })

  it('свой signal рвёт запрос сразу и без повторов: AbortError, не FetchError', async () => {
    let calls = 0
    const f = createFetch({ fetch: (i, init) => ((calls += 1), hanging(i, init)), timeoutMs: 10_000 })
    const ctrl = new AbortController()
    const pending = f('https://a.test/x', { signal: ctrl.signal, dedupe: false })
    ctrl.abort()
    const error = await pending.catch((e: unknown) => e)
    expect(isAbortError(error)).toBe(true)
    expect(calls).toBe(1)
  })

  it('уже прерванный signal — отказ до запроса', async () => {
    const s = stub(() => json({}))
    const f = createFetch({ fetch: s.fetch })
    const error = await f('https://a.test/x', { signal: AbortSignal.abort() }).catch((e: unknown) => e)
    expect(isAbortError(error)).toBe(true)
    expect(s.calls).toHaveLength(0)
  })

  it('прерывание во время паузы перед повтором', async () => {
    const ctrl = new AbortController()
    const s = stub(() => {
      ctrl.abort()
      return json({}, 503)
    })
    const f = createFetch({ fetch: s.fetch, clock: virtualClock().clock })
    const error = await f('https://a.test/x', { signal: ctrl.signal, dedupe: false }).catch((e: unknown) => e)
    expect(isAbortError(error)).toBe(true)
    expect(s.calls).toHaveLength(1)
  })
})

describe('лимиты хоста', () => {
  it('rps: шестой запуск за секунду ждёт, пока выйдет первый', async () => {
    const v = virtualClock()
    const s = stub(() => json({}), v.now)
    const f = createFetch({ fetch: s.fetch, clock: v.clock, hosts: { 'a.test': { rps: 5 } }, dedupe: false })
    const t0 = v.now()
    await Promise.all(Array.from({ length: 6 }, (_, i) => f(`https://a.test/${i}`)))
    expect(s.calls.map((c) => c.at - t0)).toEqual([0, 0, 0, 0, 0, 1_000])
  })

  it('rpm: в любой минуте не больше лимита; другой хост очереди не ждёт', async () => {
    const v = virtualClock()
    const s = stub(() => json({}), v.now)
    const f = createFetch({ fetch: s.fetch, clock: v.clock, hosts: { 'a.test': { rps: 100, rpm: 3 } } })
    const t0 = v.now()
    for (let i = 0; i < 4; i += 1) await f(`https://a.test/${i}`)
    await f('https://b.test/free')
    const at = s.calls.map((c) => c.at - t0)
    expect(at.slice(0, 4)).toEqual([0, 0, 0, 60_000])
    expect(at[4]).toBe(60_000) // b.test без правил: сразу
  })

  it('повторы тоже идут через лимит', async () => {
    const v = virtualClock()
    const s = stub((n) => (n === 1 ? json({}, 503) : json({})), v.now)
    const f = createFetch({
      fetch: s.fetch,
      clock: { ...v.clock, random: () => 0 },
      hosts: { 'a.test': { rps: 1 } },
    })
    const t0 = v.now()
    await f('https://a.test/x')
    expect(s.calls.map((c) => c.at - t0)).toEqual([0, 1_000])
  })

  it('прерванный в очереди не держит остальных', async () => {
    const v = virtualClock()
    const s = stub(() => json({}), v.now)
    const f = createFetch({ fetch: s.fetch, clock: v.clock, hosts: { 'a.test': { rps: 1 } }, dedupe: false })
    const ctrl = new AbortController()
    const first = f('https://a.test/1')
    const second = f('https://a.test/2', { signal: ctrl.signal })
    const third = f('https://a.test/3')
    ctrl.abort()
    await first
    expect(isAbortError(await second.catch((e: unknown) => e))).toBe(true)
    await third
    expect(s.calls.map((c) => c.url)).toEqual(['https://a.test/1', 'https://a.test/3'])
  })

  it('заголовки хоста по умолчанию; заголовок вызова важнее', async () => {
    const s = stub(() => json({}))
    const f = createFetch({ fetch: s.fetch, hosts: { 'a.test': { headers: { 'User-Agent': 'kit', accept: 'text/plain' } } } })
    await f('https://a.test/x', { headers: { accept: 'application/json' } })
    const h = new Headers(s.calls[0]!.init.headers)
    expect(h.get('user-agent')).toBe('kit')
    expect(h.get('accept')).toBe('application/json')
  })
})

describe('склейка одинаковых GET', () => {
  it('три одновременных GET → один запрос, у каждого своё тело', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const s = stub(async () => (await gate, json({ v: 1 })))
    const f = createFetch({ fetch: s.fetch })
    const all = Promise.all([f('https://a.test/x'), f('https://a.test/x'), f('https://a.test/x')])
    release()
    const bodies = await Promise.all((await all).map((r) => r.json()))
    expect(s.calls).toHaveLength(1)
    expect(bodies).toEqual([{ v: 1 }, { v: 1 }, { v: 1 }])
  })

  it('разные заголовки, POST и dedupe: false не склеиваются; после ответа — новый запрос', async () => {
    const s = stub(() => json({}))
    const f = createFetch({ fetch: s.fetch })
    await Promise.all([
      f('https://a.test/x'),
      f('https://a.test/x', { headers: { accept: 'text/plain' } }),
      f('https://a.test/x', { method: 'POST' }),
      f('https://a.test/x', { dedupe: false }),
    ])
    await f('https://a.test/x')
    expect(s.calls).toHaveLength(5)
  })

  it('уход одного ожидающего не рвёт запрос остальным', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const s = stub(async (_n, call) => {
      await gate
      call.init.signal?.throwIfAborted()
      return json({ v: 2 })
    })
    const f = createFetch({ fetch: s.fetch })
    const ctrl = new AbortController()
    const leaver = f('https://a.test/x', { signal: ctrl.signal })
    const stayer = f('https://a.test/x')
    ctrl.abort()
    release()
    expect(isAbortError(await leaver.catch((e: unknown) => e))).toBe(true)
    expect(await (await stayer).json()).toEqual({ v: 2 })
    expect(s.calls).toHaveLength(1)
  })

  it('отказ общего запроса без ожидающих не роняет процесс', async () => {
    const s = stub(() => {
      throw new TypeError('down')
    })
    const f = createFetch({ fetch: s.fetch, retry: false })
    const ctrl = new AbortController()
    const p = f('https://a.test/x', { signal: ctrl.signal })
    ctrl.abort()
    expect(isAbortError(await p.catch((e: unknown) => e))).toBe(true)
    await new Promise((r) => setTimeout(r, 0))
  })

  it('HEAD и 204 раздаются без тела', async () => {
    const s = stub(() => new Response(null, { status: 204 }))
    const f = createFetch({ fetch: s.fetch })
    const [a, b] = await Promise.all([f('https://a.test/x', { method: 'HEAD' }), f('https://a.test/y')])
    expect([a.status, b.status]).toEqual([204, 204])
  })
})

describe('readJson / ensureOk', () => {
  it('не JSON → fetch.parse (502)', async () => {
    const error = await readJson(new Response('<html>', { status: 200 })).catch((e: unknown) => e)
    expect(error).toMatchObject({ code: 'fetch.parse', status: 502 })
  })

  it('accept: 404 — годный ответ, если вызывающий так сказал', async () => {
    expect(await readJson(json({ error: 'nothing' }, 404), { accept: (s) => s === 404 || s < 300 })).toEqual({
      error: 'nothing',
    })
    await expect(ensureOk(json({}, 404))).rejects.toMatchObject({ code: 'fetch.status', upstreamStatus: 404 })
  })

  it('таймаут во время чтения тела → fetch.timeout; свой abort → AbortError', async () => {
    const failing = (error: Error) =>
      new Response(
        new ReadableStream({
          pull(c) {
            c.error(error)
          },
        }),
      )
    await expect(readJson(failing(new DOMException('t', 'TimeoutError')))).rejects.toMatchObject({
      code: 'fetch.timeout',
    })
    const abort = await readJson(failing(new DOMException('a', 'AbortError'))).catch((e: unknown) => e)
    expect(isAbortError(abort)).toBe(true)
  })
})

describe('склейка безопасного POST', () => {
  it('idempotent POST с одинаковым телом — один запрос; другое тело — свой', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const s = stub(async () => (await gate, json({ data: 1 })))
    const f = createFetch({ fetch: s.fetch })
    const post = (body: string, idempotent = true) => f('https://a.test/gql', { method: 'POST', body, idempotent })
    const all = Promise.all([post('{"q":1}'), post('{"q":1}'), post('{"q":2}'), post('{"q":1}', false)])
    release()
    await all
    expect(s.calls).toHaveLength(3)
  })
})
