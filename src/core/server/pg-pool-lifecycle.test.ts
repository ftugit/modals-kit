import { Pool } from 'pg'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { attachVercelPoolLifecycle } from './pg-pool-lifecycle.server.js'

const key = Symbol.for('@vercel/request-context')
const globals = globalThis as unknown as Record<symbol, unknown>
afterEach(() => {
  delete globals[key]
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

describe('жизненный цикл пула на Vercel', () => {
  it('в обычном Node не добавляет обработчик Vercel', async () => {
    const pool = new Pool({ idleTimeoutMillis: 20 })
    const before = pool.listenerCount('release')
    attachVercelPoolLifecycle(pool, false)
    expect(pool.listenerCount('release')).toBe(before)
    await pool.end()
  })

  it('регистрирует настоящий attachDatabasePool и удерживает таймер через waitUntil', async () => {
    vi.useFakeTimers()
    vi.stubEnv('VERCEL_URL', 'example.vercel.app')
    vi.stubEnv('VERCEL_REGION', 'test')
    const pending: Promise<unknown>[] = []
    globals[key] = { get: () => ({ waitUntil: (p: Promise<unknown>) => pending.push(p) }) }
    const pool = new Pool({ idleTimeoutMillis: 20 })
    const before = pool.listenerCount('release')
    attachVercelPoolLifecycle(pool, true)
    expect(pool.listenerCount('release')).toBe(before + 1)
    pool.emit('release', null, {} as never)
    expect(pending).toHaveLength(1)
    let done = false
    void pending[0]!.then(() => { done = true })
    await vi.advanceTimersByTimeAsync(119)
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(done).toBe(true)
    await pool.end()
  })
})
