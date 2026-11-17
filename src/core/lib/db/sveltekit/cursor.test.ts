import { describe, expect, it } from 'vitest'
import { cursorCodecFromEnv } from './cursor'

describe('cursor environment errors do not expose supplied values', () => {
  it('rejects invalid, repeated and active IDs without echoing them', () => {
    const secret = 'z'.repeat(40)
    for (const extra of [
      { DB_CURSOR_KID: 'invalid id secret' },
      { DB_CURSOR_KID: 'leaky-id', DB_CURSOR_OLD_KEYS: `leaky-id:${secret}` },
      { DB_CURSOR_OLD_KEYS: `leaky-id:${secret},leaky-id:${secret}` },
    ]) {
      const env: Record<string, string | undefined> = { DB_CURSOR_SECRET: secret, ...extra }
      try {
        cursorCodecFromEnv((k) => env[k])
        throw new Error('expected rejection')
      } catch (error) {
        const message = String(error)
        expect(message).not.toContain('leaky-id')
        expect(message).not.toContain('invalid id secret')
        expect(message).not.toContain(secret)
        expect(message).toContain('DB_CURSOR_')
      }
    }
  })
})
