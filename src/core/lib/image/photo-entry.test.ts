import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Codec } from './types.js'

beforeEach(() => vi.resetModules())

describe('photo entry and full codec registry', () => {
  it('photo сначала регистрирует три формата, полный вход добавляет AVIF', async () => {
    await import('./photo.js')
    const registry = await import('./registry.js')
    expect(registry.registeredFormats()).toEqual(['image/jpeg', 'image/png', 'image/webp'])
    const full = await import('./index.js')
    expect(full.registeredFormats()).toEqual(['image/jpeg', 'image/png', 'image/webp', 'image/avif'])
  })

  it('photo после полного входа не затирает пользовательский кодек или удаление', async () => {
    const full = await import('./index.js')
    const custom: Codec = { encode: async () => new Blob(['custom']) }
    full.registerEncoder('image/jpeg', custom)
    full.unregisterEncoder('image/png')
    await import('./photo.js')
    expect(full.getEncoder('image/jpeg')).toBe(custom)
    expect(full.findEncoder('image/png')).toBeUndefined()
    expect(full.registeredFormats()).toEqual(['image/jpeg', 'image/webp', 'image/avif'])
  })
})
