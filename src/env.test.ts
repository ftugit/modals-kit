import { describe, expect, it } from 'vitest'
import { generateKeyPair } from '#content/user/keys.js'
import { variables } from './env.js'

const adminSeedSchema = variables.ADMIN_SEED.schema!['~standard']

describe('env ADMIN_SEED validation (2.1)', () => {
  it('accepts undefined, empty string, and canonical 43-char 32-byte base64url keys', async () => {
    expect(adminSeedSchema.validate(undefined)).toEqual({ value: undefined })
    expect(adminSeedSchema.validate('')).toEqual({ value: undefined })

    const { secret } = await generateKeyPair()
    expect(adminSeedSchema.validate(secret)).toEqual({ value: secret })
    expect(adminSeedSchema.validate('A'.repeat(43))).toEqual({ value: 'A'.repeat(43) })
  })

  it('never leaks raw secret value in error messages', () => {
    const rawCandidate = 'SUPER_SECRET_LEAK_CANDIDATE_123456789'
    const res = adminSeedSchema.validate(rawCandidate)
    expect('issues' in res && res.issues).toBeTruthy()
    const msg = ('issues' in res && res.issues?.[0]?.message) || ''
    expect(msg).not.toContain(rawCandidate)
    expect(msg).toContain(String(rawCandidate.length))
  })

  it('rejects non-canonical 43rd base64url character with non-zero trailing bits without leaking secret', () => {
    // 'B' has base64url index 1 (low 2 bits = 01 != 00); 'D' has index 3 (low 2 bits = 11 != 00)
    for (const tail of ['B', 'D']) {
      const nonCanonical = `${'A'.repeat(42)}${tail}`
      const res = adminSeedSchema.validate(nonCanonical)
      expect('issues' in res && res.issues).toBeTruthy()
      const msg = ('issues' in res && res.issues?.[0]?.message) || ''
      expect(msg).not.toContain(nonCanonical)
      expect(msg).toContain('43-м символе')
    }
  })
})
