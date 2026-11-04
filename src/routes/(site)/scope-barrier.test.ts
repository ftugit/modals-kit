import { describe, expect, it, vi } from 'vitest'
import { createScopeBarrier } from './scope-barrier.js'

describe('session cache barrier', () => {
  it('fails closed and retries an unchanged scope after refresh failure', async () => {
    let current = 'guest'
    const refresh = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined)
    const load = vi.fn().mockResolvedValue('fresh')
    const invalidate = vi.fn()
    const b = createScopeBarrier({ initial: current, current: () => current, waitAddress: async () => {}, refresh, matches: () => true, invalidate })
    current = 'user'
    b.change(current)
    await expect(b.run(load)).rejects.toThrow('offline')
    expect(load).not.toHaveBeenCalled()
    await expect(b.run(load)).resolves.toBe('fresh')
    expect(refresh).toHaveBeenCalledTimes(2)
    expect(invalidate).toHaveBeenCalledTimes(1)
  })
  it('never loads when the refreshed server principal or status does not match', async () => {
    let current = 'guest'
    const load = vi.fn()
    const b = createScopeBarrier({ initial: current, current: () => current, waitAddress: async () => {}, refresh: async () => {}, matches: () => false, invalidate: () => {} })
    current = 'user'
    b.change(current)
    await expect(b.run(load)).rejects.toThrow('Session refresh did not settle')
    await expect(b.run(load)).rejects.toThrow('Session refresh did not settle')
    expect(load).not.toHaveBeenCalled()
  })
  it('rejects results when scope changes during preload', async () => {
    let current = 'guest'
    let finish!: (value: string) => void
    const b = createScopeBarrier({ initial: current, current: () => current, waitAddress: async () => {}, refresh: async () => {}, matches: () => true, invalidate: () => {} })
    const pending = b.run(() => new Promise<string>((resolve) => { finish = resolve }))
    await Promise.resolve()
    current = 'user'
    b.change(current)
    finish('stale')
    await expect(pending).rejects.toThrow('Session changed during modal preload')
  })
  it('does not let an old refresh rejection mark a newer principal as failed', async () => {
    let current = 'guest'
    let rejectOld!: (reason: Error) => void
    const refresh = vi.fn().mockImplementationOnce(() => new Promise<void>((_, reject) => { rejectOld = reject })).mockResolvedValue(undefined)
    const b = createScopeBarrier({ initial: current, current: () => current, waitAddress: async () => {}, refresh, matches: () => true, invalidate: () => {} })
    current = 'alice'; b.change(current)
    await Promise.resolve(); await Promise.resolve()
    const old = b.run(async () => 'old')
    current = 'bob'; b.change(current)
    expect(await b.run(async () => 'bob')).toBe('bob')
    rejectOld(new Error('stale error'))
    await expect(old).rejects.toThrow('stale error')
    expect(await b.run(async () => 'still bob')).toBe('still bob')
    expect(refresh).toHaveBeenCalledTimes(2)
  })
  it('cancels a stale principal while its address has not settled', async () => {
    let current = 'guest'
    let release!: () => void
    const address = new Promise<void>((resolve) => { release = resolve })
    const refresh = vi.fn().mockResolvedValue(undefined)
    const b = createScopeBarrier({ initial: current, current: () => current, waitAddress: () => address, refresh, matches: () => true, invalidate: () => {} })
    current = 'alice'; b.change(current)
    await Promise.resolve()
    current = 'guest'; b.change(current)
    release()
    expect(await b.run(async () => 'guest')).toBe('guest')
    expect(refresh).toHaveBeenCalledTimes(1)
  })

})
