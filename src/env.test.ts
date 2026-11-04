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

describe('key identifiers and rotation validation', () => {
  const validate = (name: 'AUTH_SEAL_ID' | 'DB_CURSOR_KID' | 'AUTH_SEAL_OLD_KEYS' | 'DB_CURSOR_OLD_KEYS' | 'DATABASE_RESET', value: string) =>
    variables[name].schema!['~standard'].validate(value)
  const error = (v: unknown) => JSON.stringify(v)
  it('uses separate 32-character alphabets for iron and cursors', () => {
    expect(validate('AUTH_SEAL_ID', 'key-with-dash')).toHaveProperty('issues')
    expect(validate('AUTH_SEAL_ID', 'a'.repeat(32))).toEqual({ value: 'a'.repeat(32) })
    expect(validate('DB_CURSOR_KID', `key-${'a'.repeat(28)}`)).toEqual({ value: `key-${'a'.repeat(28)}` })
    expect(validate('DB_CURSOR_KID', 'a'.repeat(33))).toHaveProperty('issues')
  })
  it('rejects invalid or repeated rotation identifiers without echoing values', () => {
    const secret = 'SECRETCANDIDATE'.repeat(3)
    for (const name of ['AUTH_SEAL_OLD_KEYS', 'DB_CURSOR_OLD_KEYS'] as const) {
      for (const raw of [`bad id:${secret}`, `key:${secret},key:${secret}`, `id:${'SHORTSECRET'}`]) {
        const result = validate(name, raw)
        expect(result).toHaveProperty('issues')
        expect(error(result)).not.toContain(raw)
        expect(error(result)).not.toContain(secret)
        expect(error(result)).not.toContain('SHORTSECRET')
      }
    }
    expect(validate('AUTH_SEAL_OLD_KEYS', `old-key:${secret}`)).toHaveProperty('issues')
    expect(validate('DB_CURSOR_OLD_KEYS', `old-key:${secret}`)).toEqual({ value: `old-key:${secret}` })
    for (const name of ['AUTH_SEAL_ID', 'DB_CURSOR_KID', 'DATABASE_RESET'] as const) {
      const raw = 'SENSITIVE-INVALID-VALUE-WITH-SPACES secret'
      const result = validate(name, raw)
      expect(result).toHaveProperty('issues')
      expect(error(result)).not.toContain(raw)
    }
  })
})


describe('WS lifetime env validation', () => {
  it('accepts bounded positive timer seconds, and blank values', () => {
    for (const name of ['WS_UPLOAD_TTL_SECONDS', 'WS_UPLOAD_IDLE_SECONDS'] as const) {
      const validate = variables[name].schema!['~standard'].validate
      expect(validate('')).toEqual({ value: undefined })
      expect(validate('300')).toEqual({ value: 300 })
      expect(validate('2147483')).toEqual({ value: 2147483 })
      for (const invalid of ['0', '-1', '1.5', '2147484', 'NaN']) expect(validate(invalid)).toHaveProperty('issues')
    }
  })
  it('allows zero to disable pause', () => {
    const validate = variables.WS_UPLOAD_PAUSE_MAX_SECONDS.schema!['~standard'].validate
    expect(validate('0')).toEqual({ value: 0 })
    expect(validate('60')).toEqual({ value: 60 })
    expect(validate('-1')).toHaveProperty('issues')
  })
  it('requires a positive rate budget', () => {
    const validate = variables.WS_UPLOAD_RATE_BUDGET_BYTES_PER_SECOND.schema!['~standard'].validate
    expect(validate('32768')).toEqual({ value: 32768 })
    expect(validate('0')).toHaveProperty('issues')
    expect(validate('-10')).toHaveProperty('issues')
  })
})
