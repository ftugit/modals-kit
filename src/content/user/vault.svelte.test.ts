// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from 'vitest'
import { createVault, type RenewPostOutcome, type VaultPayload } from './vault.svelte.js'
import { bindComponentForm, setFormSessionInterceptor } from '#hooks/component-form/client.svelte.js'
import { defineForm, field } from '#lib/form/index.js'
import { forms } from '#lib/components/form/forms.config.js'

const samplePayload = (overrides: Partial<VaultPayload> = {}): VaultPayload => ({
  access: 'sealed.access.1',
  expiresAt: 1_000_000,
  ttlMs: 300_000,
  sub: 'user-1',
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
    setFormSessionInterceptor(null)
    vi.restoreAllMocks()
  })

  test('инкапсуляция замыкания и единый API без readUser: SSR до syncServer, RAM после hydrate/clear', () => {
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

    // Первичная синхронизация переносит снимок в RAM.
    v.syncServer(ssrSnapshot)
    expect(v.authorized).toBe(true)

    // Выход очищает RAM, и повторный проход старого SSR-объекта НЕ воскрешает сессию.
    v.clear()
    expect(v.authorized).toBe(false)
    expect(v.principal).toBeNull()
    v.syncServer(ssrSnapshot)
    expect(v.authorized).toBe(false)

    // Вход и смена профиля мгновенно обновляют геттеры даже при ssrSnapshot = null.
    ssrSnapshot = null
    v.hydrate(samplePayload({ access: 'ram.2', sub: 'user-2', prof: { nickname: 'Живой', avatarUrl: '/a.webp' } }))
    expect(v.authorized).toBe(true)
    expect(v.principal).toBe('user-2')
    expect(v.profile).toEqual({ nickname: 'Живой', avatarUrl: '/a.webp' })
    v.dispose()
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

    v.hydrate(samplePayload({ access: 'old', expiresAt: 1_000_000, ttlMs: 300_000 }))
    const pendingRenew = v.renew(true)
    await started

    // Пока старый renew летел, пользователь нажал «Выйти».
    v.clear()
    resolveSlowRenew({
      kind: 'ok',
      data: samplePayload({ access: 'zombie', expiresAt: 1_300_000, prof: { nickname: 'Зомби', avatarUrl: null } }),
    })

    await pendingRenew
    expect(v.authorized).toBe(false)
    expect(v.principal).toBeNull()
    v.dispose()
  })

  test('navigator.locks + BroadcastChannel синхронизируют продление, профиль и выход между вкладками за 1 сетевой запрос', async () => {
    const restoreLocks = installMockLocks()
    const channel = `test-sync-${crypto.randomUUID()}`
    let networkCalls = 0
    const currentClock = 995_000

    const transport = async (): Promise<RenewPostOutcome> => {
      networkCalls += 1
      await new Promise((r) => setTimeout(r, 20))
      // Ждём доставку BroadcastChannel во вторую вкладку до отпускания замка
      return {
        kind: 'ok',
        data: samplePayload({
          access: 'fresh.shared',
          expiresAt: 1_300_000,
          ttlMs: 300_000,
          prof: { nickname: 'Синхронный Ник', avatarUrl: null },
        }),
      }
    }

    const tabA = createVault({ channelName: channel, now: () => currentClock, postRenewTransport: transport })
    const tabB = createVault({ channelName: channel, now: () => currentClock, postRenewTransport: transport })

    const initial = samplePayload({ access: 'init', expiresAt: 1_000_000, ttlMs: 300_000 })
    tabA.syncServer(initial)
    tabB.syncServer(initial)

    // Обе вкладки одновременно попали в лид-окно продления:
    await Promise.all([tabA.renew(false), tabB.renew(false)])
    await new Promise((r) => setTimeout(r, 15))

    expect(tabA.profile.nickname).toBe('Синхронный Ник')
    expect(tabB.profile.nickname).toBe('Синхронный Ник')
    expect(networkCalls).toBe(1)

    // Выход во вкладке B мгновенно разлогинивает вкладку A.
    tabB.clear()
    await new Promise((r) => setTimeout(r, 15))
    expect(tabA.authorized).toBe(false)
    expect(tabB.authorized).toBe(false)

    tabA.dispose()
    tabB.dispose()
    restoreLocks()
  })

  test('замороженный таймер (Пункт 6): ensureFresh + onAuthExpired прозрачно продлевает токен и повторяет запрос', async () => {
    const clock = 2_000_000
    let renewCalls = 0

    const v = createVault({
      channelName: null,
      now: () => clock,
      postRenewTransport: async () => {
        renewCalls += 1
        return {
          kind: 'ok',
          data: samplePayload({ access: `renewed.${renewCalls}`, expiresAt: clock + 300_000, ttlMs: 300_000 }),
        }
      },
    })
    // Гидратируем уже просроченным токеном (имитируем заморозку мобильной вкладки, где setTimeout не сработал).
    v.syncServer(samplePayload({ access: 'dead.1', expiresAt: 1_000_000, ttlMs: 300_000 }))
    // Подождём авто-тики, если были, и сбросим счётчик для чистой проверки перехватчика формы:
    await new Promise((r) => setTimeout(r, 10))
    v.syncServer(samplePayload({ access: 'dead.2', expiresAt: 1_000_000, ttlMs: 300_000 }))
    renewCalls = 0

    setFormSessionInterceptor({
      ensureFresh: () => v.ensureFresh(),
      onAuthExpired: () => v.renew(true),
    })

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
      bound = bindComponentForm(forms, probeForm, { action: '/probe' })
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
