/**
 * Политика опроса — проверяется без браузера и без живого таймера.
 *
 * Здесь важны ровно четыре утверждения, и все они — про «не навреди»: «ничего
 * нового» не должно читать базу (304 без вызова `onFresh`), ошибки не должны
 * учащать запросы (backoff + `Retry-After`), скрытая вкладка обязана останавливать
 * опрос, а висящий запрос — не должен превращать тики в параллельные.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { backoffDelay, createLive, isHidden, retryAfterMs } from './live.svelte'

describe('этика опроса', () => {
  it('удвоение с потолком в минуту: авария не лечится чаще', () => {
    expect(backoffDelay(0, 2_000)).toBe(2_000)
    expect(backoffDelay(1, 2_000)).toBe(4_000)
    expect(backoffDelay(5, 2_000)).toBe(60_000)
    expect(backoffDelay(9, 2_000)).toBe(60_000)
  })

  it('Retry-After важнее нашей шкалы, но в коридоре [интервал, 120 с]', () => {
    expect(retryAfterMs(null, 2_000)).toBeNull()
    expect(retryAfterMs('мусор', 2_000)).toBeNull()
    // «сейчас же» не означает «нулевой паузы»: минимальный шаг — интервал.
    expect(retryAfterMs('0', 2_000)).toBe(2_000)
    expect(retryAfterMs('120', 2_000)).toBe(120_000)
    expect(retryAfterMs('999999', 2_000)).toBe(120_000)
  })

  it('без документа нет и признака скрытости (SSR не «ставит на паузу» навечно)', () => {
    expect(isHidden()).toBe(false)
    expect(isHidden({ visibilityState: 'hidden' } as Document)).toBe(true)
    expect(isHidden({ visibilityState: 'visible' } as Document)).toBe(false)
  })
})

describe('createLive', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  const response = (init: { status?: number; etag?: string } = {}): Response =>
    new Response(init.status === 304 ? null : JSON.stringify({ items: [] }), {
      status: init.status ?? 200,
      headers: init.etag ? { etag: init.etag } : undefined,
    })

  it('304 не поднимает «изменилось», новый ETag поднимает, и заголовок уходит дальше', async () => {
    const seen: string[] = []
    const fresh: boolean[] = []
    let first = true
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      seen.push(headers.get('if-none-match') ?? '')
      // Первый ответ — 200 с отпечатком; дальше сервер говорит «не изменилось».
      if (first) {
        first = false
        return response({ etag: 'W/"aaa"' })
      }
      return response({ status: 304 })
    })
    const live = createLive({
      url: () => '/api/db-posts?page=1&size=5',
      onFresh: () => {
        fresh.push(true)
      },
      intervalMs: 1_000,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    live.start()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(live.stats().ticks).toBe(1)
    expect(fresh).toHaveLength(0) // первой страницы мы ещё не видели: «не с чем сравнить»
    expect(seen[0]).toBe('')
    await vi.advanceTimersByTimeAsync(1_000)
    expect(seen[1]).toBe('W/"aaa"')
    expect(live.stats().ticks).toBe(2)
    expect(fresh).toHaveLength(0)
    expect(live.stats().errors).toBe(0)
    live.stop()
  })

  it('смена отпечатка зовёт onFresh ровно один раз на тик', async () => {
    let calls = 0
    let n = 0
    const fetchImpl = vi.fn(async () => response({ etag: `W/"v${(n += 1)}"` }))
    const live = createLive({
      url: () => '/x',
      onFresh: () => {
        calls += 1
      },
      intervalMs: 500,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    live.start()
    await vi.advanceTimersByTimeAsync(500)
    await vi.advanceTimersByTimeAsync(500)
    // Первая выдача — эталон (ею ничего не обновляют), вторая — уже сравнение.
    expect(calls).toBe(1)
    expect(live.stats().changed).toBe(1)
    live.stop()
  })

  it('сбой удлиняет паузу, успех её обнуляет', async () => {
    let fail = true
    const fetchImpl = vi.fn(async () => {
      if (fail) throw new Error('сеть')
      return response({ etag: 'W/"ok"' })
    })
    const live = createLive({
      url: () => '/x',
      onFresh: () => {},
      intervalMs: 1_000,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    live.start()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(live.stats().errors).toBe(1)
    expect(live.stats().waitMs).toBe(2_000) // 1_000 * 2^1, а не «снова раз в секунду»
    // Следующий тик обязан случиться НЕ раньше 2 с: на 1.5 с ещё тишина.
    await vi.advanceTimersByTimeAsync(1_000)
    expect(live.stats().ticks).toBe(1)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(live.stats().ticks).toBe(2)
    expect(live.stats().errors).toBe(2)
    expect(live.stats().waitMs).toBe(4_000) // 1_000 * 2^2 — шкала растёт, пока сервер молчит
    fail = false
    await vi.advanceTimersByTimeAsync(4_000)
    expect(live.stats().ticks).toBe(3)
    expect(live.stats().errors).toBe(0)
    expect(live.stats().waitMs).toBe(1_000)
    live.stop()
  })

  it('пока ответ в полёте, второй запрос не стартует', async () => {
    let release: (() => void) | null = null
    let started = 0
    const fetchImpl = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          started += 1
          release = () => resolve(response({ etag: 'W/"1"' }))
        }),
    )
    const live = createLive({
      url: () => '/x',
      onFresh: () => {},
      intervalMs: 500,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    live.start()
    await vi.advanceTimersByTimeAsync(500)
    expect(started).toBe(1)
    // Пять интервалов с незакрытым ответом — и ни одного нового запроса.
    for (let i = 0; i < 5; i += 1) await vi.advanceTimersByTimeAsync(500)
    expect(started).toBe(1)
    expect(live.stats().ticks).toBe(1)
    release?.()
    await vi.advanceTimersByTimeAsync(0)
    live.stop()
  })

  it('`url() = null` — тикхолостой: запрос не уходит вовсе', async () => {
    const fetchImpl = vi.fn(async () => response())
    const live = createLive({
      url: () => null,
      onFresh: () => {},
      intervalMs: 300,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    live.start()
    await vi.advanceTimersByTimeAsync(1_200)
    expect(fetchImpl).not.toHaveBeenCalled()
    live.stop()
    expect(live.running()).toBe(false)
  })
})
