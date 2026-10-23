// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from 'vitest'
import { createVault, type RenewPostOutcome, type VaultPayload } from './vault.svelte.js'
import { bindComponentForm } from '#hooks/component-form/client.svelte.js'
import { defineForm, field } from '#lib/form/index.js'
import { forms } from '#components/form/forms.config.js'

const samplePayload = (overrides: Partial<VaultPayload> = {}): VaultPayload => ({
  sub: 'user-1',
  iat: 700_000,
  expiresAt: 1_000_000,
  ttlMs: 300_000,
  prof: { nickname: 'SSR Ник', avatarUrl: null },
  ...overrides,
})

/** Лёгкий Web Locks полифилл для happy-dom, воспроизводящий браузерный межвкладочный мьютекс. */
function installMockLocks(): () => void {
  const queues = new Map<string, Promise<unknown>>()
  const prev = (navigator as Navigator & { locks?: unknown }).locks
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: {
      request: async <T>(name: string, cb: () => Promise<T>): Promise<T> => {
        const wait = queues.get(name) ?? Promise.resolve()
        const next = wait.catch(() => undefined).then(() => cb())
        queues.set(name, next)
        return next
      },
    },
  })
  return () => {
    Object.defineProperty(navigator, 'locks', { configurable: true, value: prev })
  }
}

describe('vault: замыкание, межвкладочная синхронизация и восстановление после сна', () => {
  afterEach(() => {
    window.localStorage.clear()
    vi.restoreAllMocks()
  })

  test('инкапсуляция замыкания без сырого access, корректный authStamp при гостевом входе и серверном отзыве', () => {
    let ssrSnapshot: VaultPayload | null = samplePayload()
    const v = createVault({
      channelName: null,
      now: () => 500_000,
      readSsrUser: () => ssrSnapshot,
    })

    // Снаружи нет публичных мутабельных полей `access`, `expiresAt`, `epoch`.
    expect('access' in (v as unknown as Record<string, unknown>)).toBe(false)
    expect('expiresAt' in (v as unknown as Record<string, unknown>)).toBe(false)

    // До первой клиентской синхронизации читается SSR-снимок.
    expect(v.authorized).toBe(true)
    expect(v.principal).toBe('user-1')
    expect(v.profile.nickname).toBe('SSR Ник')

    // Сценарий AS-03: старт гостем (stamp=1) → вход в модалке → клиентская навигация со старым кэшем (stamp=1) → реальный отзыв на сервере (stamp=2, null).
    ssrSnapshot = null
    v.syncServer(null, 1)
    expect(v.authorized).toBe(false)

    v.hydrate(samplePayload({ sub: 'user-2', iat: 800_000, prof: { nickname: 'Живой', avatarUrl: '/a.webp' } }))
    expect(v.authorized).toBe(true)

    // Обычный клиентский переход без перезапуска +layout.server.ts (stamp остался 1): НЕ затирает RAM!
    v.syncServer(null, 1)
    expect(v.authorized).toBe(true)
    expect(v.principal).toBe('user-2')

    // Реальный перезапуск +layout.server.ts после отзыва сессии (stamp вырос до 2, ответ null): немедленно разлогинивает!
    v.syncServer(null, 2)
    expect(v.authorized).toBe(false)
    expect(v.principal).toBeNull()

    v.dispose()
  })

  test('dispose() полностью снимает слушатели visibilitychange и online без утечек', () => {
    let calls = 0
    const v = createVault({
      channelName: null,
      now: () => 2_000_000,
      postRenewTransport: async () => {
        calls += 1
        return { kind: 'ok', data: samplePayload({ expiresAt: 2_300_000 }) }
      },
    })
    v.hydrate(samplePayload({ expiresAt: 1_000_000 }))
    v.dispose()

    calls = 0
    window.dispatchEvent(new Event('online'))
    document.dispatchEvent(new Event('visibilitychange'))
    expect(calls).toBe(0)
  })

  test('гонка in-flight renew против logout и смены профиля отсекается счётчиком поколений epoch', async () => {
    let resolveSlowRenew!: (value: RenewPostOutcome) => void
    let markStarted!: () => void
    const started = new Promise<void>((r) => {
      markStarted = r
    })
    const v = createVault({
      channelName: null,
      now: () => 500_000,
      postRenewTransport: () =>
        new Promise<RenewPostOutcome>((resolve) => {
          resolveSlowRenew = resolve
          markStarted()
        }),
    })

    v.hydrate(samplePayload({ iat: 700_000, expiresAt: 1_000_000, ttlMs: 300_000 }))
    const pendingRenew = v.renew(true)
    await started

    // Пока старый renew летел, пользователь нажал «Выйти».
    v.clear()
    resolveSlowRenew({
      kind: 'ok',
      data: samplePayload({ iat: 999_000, expiresAt: 1_300_000, prof: { nickname: 'Зомби', avatarUrl: null } }),
    })

    await pendingRenew
    expect(v.authorized).toBe(false)
    expect(v.principal).toBeNull()
    v.dispose()
  })

  test('AS-05: одновременное пробуждение 3 спящих вкладок (ensureFresh, force=true) делает строго 1 сетевой POST без setTimeout-костылей', async () => {
    const restoreLocks = installMockLocks()
    const channel = `test-sync-${crypto.randomUUID()}`
    let networkCalls = 0
    const currentClock = 2_000_000

    const transport = async (): Promise<RenewPostOutcome> => {
      networkCalls += 1
      await new Promise((r) => setTimeout(r, 10))
      return {
        kind: 'ok',
        data: samplePayload({
          iat: currentClock,
          expiresAt: currentClock + 300_000,
          ttlMs: 300_000,
          prof: { nickname: 'Синхронный Ник', avatarUrl: null },
        }),
      }
    }

    const tabA = createVault({ channelName: channel, now: () => currentClock, postRenewTransport: transport })
    const tabB = createVault({ channelName: channel, now: () => currentClock, postRenewTransport: transport })
    const tabC = createVault({ channelName: channel, now: () => currentClock, postRenewTransport: transport })

    const expiredInitial = samplePayload({ iat: 700_000, expiresAt: 1_000_000, ttlMs: 300_000 })
    tabA.syncServer(expiredInitial, 1)
    tabB.syncServer(expiredInitial, 1)
    tabC.syncServer(expiredInitial, 1)

    // Все 3 спящие вкладки проснулись одновременно и вызвали ensureFresh() (force=true):
    const [okA, okB, okC] = await Promise.all([
      tabA.ensureFresh(),
      tabB.ensureFresh(),
      tabC.ensureFresh(),
    ])

    expect([okA, okB, okC]).toEqual([true, true, true])
    expect(networkCalls).toBe(1)
    expect(tabA.profile.nickname).toBe('Синхронный Ник')
    expect(tabB.profile.nickname).toBe('Синхронный Ник')
    expect(tabC.profile.nickname).toBe('Синхронный Ник')

    // Выход во вкладке B мгновенно разлогинивает все вкладки.
    tabB.clear()
    await new Promise((r) => setTimeout(r, 15))
    expect(tabA.authorized).toBe(false)
    expect(tabB.authorized).toBe(false)
    expect(tabC.authorized).toBe(false)

    tabA.dispose()
    tabB.dispose()
    tabC.dispose()
    restoreLocks()
  })

  test('замороженный таймер (Пункт 6): явный session в bindComponentForm продлевает токен и повторяет запрос 1 раз', async () => {
    const clock = 2_000_000
    let renewCalls = 0

    const v = createVault({
      channelName: null,
      now: () => clock,
      postRenewTransport: async () => {
        renewCalls += 1
        return {
          kind: 'ok',
          data: samplePayload({ iat: clock + renewCalls, expiresAt: clock + 300_000, ttlMs: 300_000 }),
        }
      },
    })
    v.syncServer(samplePayload({ iat: 700_000, expiresAt: 1_000_000, ttlMs: 300_000 }), 1)
    await new Promise((r) => setTimeout(r, 10))
    v.syncServer(samplePayload({ iat: 700_001, expiresAt: 1_000_000, ttlMs: 300_000 }), 2)
    renewCalls = 0

    const probeForm = defineForm({
      id: 'retry-probe',
      fields: { title: field.text({ label: 'Title' }) },
    })

    const prevFetch = globalThis.fetch
    let postAttempts = 0
    globalThis.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      postAttempts += 1
      const keys = probeForm.policy.envelopeKeys
      const readField = (k: string) =>
        init?.body instanceof FormData || init?.body instanceof URLSearchParams
          ? String(init.body.get(k) ?? '')
          : new URLSearchParams(String(init?.body ?? '')).get(k) ?? ''
      const envelopeEcho = {
        formId: readField(keys.id) || 'retry-probe',
        instance: readField(keys.instance) || undefined,
        submissionId: readField(keys.submission),
        revision: Number(readField(keys.rev) || 1),
      }
      if (postAttempts === 1) {
        return new Response(
          JSON.stringify({
            data: {
              result: {
                v: 1,
                ...envelopeEcho,
                ok: false,
                status: 401,
                outcome: 'not-applied',
                errors: [{ id: '*:auth.expired:0', code: 'auth.expired', message: 'expired', origin: 'server' }],
                values: {},
              },
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      return new Response(
        JSON.stringify({
          data: {
            result: {
              v: 1,
              ...envelopeEcho,
              ok: true,
              status: 200,
              outcome: 'committed',
              errors: [],
              values: {},
              data: { saved: true },
            },
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    })

    let bound!: ReturnType<typeof bindComponentForm>
    const stop = $effect.root(() => {
      bound = bindComponentForm(forms, probeForm, {
        action: '/probe',
        session: {
          ensureFresh: () => v.ensureFresh(),
          onAuthExpired: () => v.renew(true),
        },
      })
    })

    const fd = new FormData()
    fd.set('title', 'Важные данные после сна вкладки')
    await bound.submit(fd)

    expect(renewCalls).toBeGreaterThanOrEqual(1)
    expect(postAttempts).toBe(2)
    expect(bound.state.result?.ok).toBe(true)

    stop()
    v.dispose()
    globalThis.fetch = prevFetch
  })
})
