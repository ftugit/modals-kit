// Опрос исхода queued (B2): отмена прерывает паузу, пауза сервера ограничена.
import { afterEach, beforeEach, expect, suite, test, vi } from 'vitest'
import { pollUntilDone, type PollOutcome } from './queued'

const d = { pollUrl: '/poll', statusUrl: '/status' }

suite('pollUntilDone (B2)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  test('отмена прерывает паузу, а не ждёт её конца', async () => {
    const ac = new AbortController()
    const poll = vi.fn(async (): Promise<PollOutcome> => ({ done: false, retryAfterMs: 50_000 }))
    let settled = false
    const run = pollUntilDone(d, poll, { signal: ac.signal }).then((r) => { settled = true; return r })
    await vi.advanceTimersByTimeAsync(10)
    ac.abort()
    await vi.advanceTimersByTimeAsync(0)
    expect(settled).toBe(true)
    expect(await run).toBeUndefined()
    expect(poll).toHaveBeenCalledTimes(1)
  })

  test('огромная пауза сервера ограничена минутой; не-число — секунда', async () => {
    const answers: PollOutcome[] = [
      { done: false, retryAfterMs: 1e12 },
      { done: false, retryAfterMs: Number.NaN },
      { done: true, result: { ok: true } as never },
    ]
    const poll = vi.fn(async () => answers.shift()!)
    const run = pollUntilDone(d, poll)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(poll).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(poll).toHaveBeenCalledTimes(3)
    expect(await run).toEqual({ ok: true })
  })
})
