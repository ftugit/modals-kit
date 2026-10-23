import { afterEach, describe, expect, it, vi } from 'vitest'
import { afterResponse } from './after-response.server.js'

// Тот же ключ, под которым среда Vercel кладёт контекст запроса (его читает
// `@vercel/functions` — пакет здесь настоящий, не мок).
const VERCEL_CONTEXT = Symbol.for('@vercel/request-context')
const global = globalThis as Record<symbol, unknown>

afterEach(() => {
  delete global[VERCEL_CONTEXT]
  vi.restoreAllMocks()
})

describe('afterResponse', () => {
  it('на Vercel: промис уходит в waitUntil контекста запроса', async () => {
    const registered: Promise<unknown>[] = []
    global[VERCEL_CONTEXT] = { get: () => ({ waitUntil: (p: Promise<unknown>) => registered.push(p) }) }
    const done = afterResponse(Promise.resolve(42))
    expect(registered).toHaveLength(1)
    expect(registered[0]).toBe(done)
    await expect(done).resolves.toBeUndefined()
  })

  it('вне Vercel и Cloudflare: задача просто выполняется, без ошибок', async () => {
    let ran = false
    await afterResponse(Promise.resolve().then(() => { ran = true }))
    expect(ran).toBe(true)
  })

  it('на Cloudflare: waitUntil вызывается методом ExecutionContext, Vercel не трогается', async () => {
    const vercel = vi.fn()
    global[VERCEL_CONTEXT] = { get: () => ({ waitUntil: vercel }) }
    const context = {
      seen: [] as Promise<unknown>[],
      waitUntil(p: Promise<unknown>) {
        // оторванный вызов дал бы другой this — как «Illegal invocation» у воркера
        if (this !== context) throw new TypeError('Illegal invocation')
        this.seen.push(p)
      },
    }
    const done = afterResponse(Promise.resolve(), { platform: { context } })
    expect(context.seen).toEqual([done])
    expect(vercel).not.toHaveBeenCalled()
    await done
  })

  it('отказ задачи не всплывает: ловится и пишется в лог', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(afterResponse(Promise.reject(new Error('сеть')))).resolves.toBeUndefined()
    expect(log).toHaveBeenCalledOnce()
    expect(String(log.mock.calls[0]![1])).toContain('сеть')
  })
})
