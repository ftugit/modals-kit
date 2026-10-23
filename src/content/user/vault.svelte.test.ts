// @vitest-environment happy-dom
import { afterEach, describe, expect, test } from 'vitest'
import { readUser, vault, type VaultPayload } from './vault.svelte.js'

describe('vault RAM state & readUser reactivity', () => {
  afterEach(() => {
    vault.clear()
  })

  test('falls back to server payload before hydration and switches instantly on hydrate/clear in RAM', () => {
    const staleLoggedIn: VaultPayload = {
      access: 'ssr.token.1',
      expiresAt: Date.now() + 60_000,
      ttlMs: 60_000,
      sub: 'user-ssr',
      prof: { nickname: 'SSR Ник', avatarUrl: null },
    }

    // До первой инициализации вкладки (vault.synced === false) читается снимок сервера.
    expect(readUser(staleLoggedIn)?.prof.nickname).toBe('SSR Ник')

    // Клиент синхронизировал начальное состояние с сервера.
    vault.syncServer(staleLoggedIn)
    expect(readUser(staleLoggedIn)?.prof.nickname).toBe('SSR Ник')

    // Повторный проход layout с тем же staleLoggedIn после локального выхода НЕ откатывает выход!
    vault.clear()
    expect(readUser(staleLoggedIn)).toBeNull()
    vault.syncServer(staleLoggedIn)
    expect(readUser(staleLoggedIn)).toBeNull()

    // Мгновенный вход (vault.hydrate): даже если layout ещё держит гостя (null),
    // readUser немедленно отдаёт живой профиль из RAM.
    vault.hydrate({
      access: 'ram.token.2',
      expiresAt: Date.now() + 60_000,
      ttlMs: 60_000,
      sub: 'user-ram',
      prof: { nickname: 'Живой Ник', avatarUrl: null },
    })
    expect(readUser(null)).toEqual({
      prof: { nickname: 'Живой Ник', avatarUrl: null },
    })

    // Обновление профиля в RAM сразу отражается во всех потребителях readUser.
    vault.hydrate({
      access: 'ram.token.3',
      expiresAt: Date.now() + 60_000,
      ttlMs: 60_000,
      sub: 'user-ram',
      prof: { nickname: 'Обновлённый Ник', avatarUrl: '/avatar.jpg' },
    })
    expect(readUser(staleLoggedIn)?.prof).toEqual({
      nickname: 'Обновлённый Ник',
      avatarUrl: '/avatar.jpg',
    })
  })
})
