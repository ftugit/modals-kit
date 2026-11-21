import { describe, expect, it } from 'vitest'
import { createSchemaAdmin } from './admin.js'

const schema = {
  sync: async () => ({ enabled: true, steps: [] }),
} as never
const driver = (async () => {
  throw new Error('verify must not touch the driver')
}) as never

describe('schema admin: доступ к отчёту', () => {
  it('без токена кнопка и доступ выключены', async () => {
    const admin = createSchemaAdmin({ schema, driver, token: undefined })
    expect(admin.enabled).toBe(false)
    expect(await admin.verify('anything')).toBe(false)
  })

  it('verify сверяет секрет и не открывает драйвер', async () => {
    const admin = createSchemaAdmin({ schema, driver, token: 'secret-token-32-characters-long!!' })
    expect(admin.enabled).toBe(true)
    expect(await admin.verify('secret-token-32-characters-long!!')).toBe(true)
    expect(await admin.verify('secret-token-32-characters-long!?')).toBe(false)
    expect(await admin.verify('')).toBe(false)
    expect(await admin.verify(undefined)).toBe(false)
    expect(await admin.verify(42)).toBe(false)
  })
})
