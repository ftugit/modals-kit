// @vitest-environment happy-dom
// Выход по решению сервера: терминальный отказ продления гасит витрину и
// отдаёт причину наружу — экран ACL/toast рисует приложение.
import { describe, expect, test } from 'vitest'
import { createVault } from './vault.svelte.js'
import type { VaultPayload } from './vault.svelte.js'

const meta: VaultPayload = {
  sub: 'u1',
  iat: 1,
  expiresAt: 2,
  ttlMs: 1,
  prof: { nickname: 'nick', avatarUrl: null },
}

describe('выход по решению сервера', () => {
  test('терминальный отказ: витрина гаснет, код приходит в подписку и колбэк', async () => {
    const seen: string[] = []
    const app: string[] = []
    const vault = createVault({
      channelName: null,
      now: () => 10,
      readSsrUser: () => null,
      postRenewTransport: async () => ({ kind: 'revoked', code: 'auth.blocked' }),
      onSessionLost: (code) => app.push(code),
    })
    const off = vault.onSessionLost((code) => seen.push(code))
    vault.hydrate(meta)
    expect(vault.authorized).toBe(true)

    const renewed = await vault.renew(true)

    expect(renewed).toBe(false)
    expect(vault.authorized).toBe(false)
    expect(vault.sessionLost).toBe('auth.blocked')
    expect(seen).toEqual(['auth.blocked'])
    expect(app).toEqual(['auth.blocked'])

    off()
    vault.dispose()
  })

  test('успешное продление снимает прежнюю причину', async () => {
    const vault = createVault({
      channelName: null,
      now: () => 10,
      readSsrUser: () => null,
      postRenewTransport: async () => ({
        kind: 'ok',
        data: { ...meta, iat: 20, expiresAt: 30 },
      }),
    })
    vault.hydrate(meta)

    await vault.renew(true)

    expect(vault.sessionLost).toBeNull()
    expect(vault.authorized).toBe(true)
    vault.dispose()
  })
})
