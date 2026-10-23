/**
 * Vault — единый реактивный стор сессии вкладки на лексическом замыкании.
 *
 * Архитектурные инварианты (утверждены в `docs/audit/auth-session.md`):
 * 1. Оба токена живут в `HttpOnly`-куках; долгоживущий `auth_sid` (`renewal`)
 *    никогда не сериализуется в JSON и не попадает в память браузера.
 * 2. Внутри приватного замыкания `createVault()` хранятся только короткоживущие
 *    метаданные сессии (`access`, `expiresAt`, `ttlMs`, `sub`, `prof`, `epoch`).
 *    Снаружи доступны исключительно read-only геттеры (`authorized`, `principal`,
 *    `profile`, `renewing`) и методы жизненного цикла.
 * 3. Бесшовный SSR и гидратация без `readUser`: до первой инициализации вкладки
 *    геттеры прозрачно читают `page.data.user`, а после синхронизации — только
 *    реактивные `$state`-переменные замыкания.
 * 4. Межвкладочная координация: `5%`-й джиттер + `navigator.locks` +
 *    `BroadcastChannel('modals-kit:user')` синхронизируют вход, выход, смену
 *    профиля и продление между всеми открытыми вкладками без лишних кук и без
 *    дублирующих сетевых запросов; счётчик `epoch` и `AbortController` отсекают
 *    запоздавшие ответы старых `renew` после выхода или смены профиля.
 * 5. Пробуждение замороженной вкладки: `visibilitychange` + `online` +
 *    интеграция с `setFormSessionInterceptor` автоматически продлевают мёртвый
 *    временный токен и прозрачно повторяют прерванную операцию.
 */
import { page } from '$app/state'
import { visibleAddress } from '#lib/address/sveltekit.js'
import { setFormSessionInterceptor } from '#hooks/component-form/session-interceptor.js'
import { fireAt, leadFor, overdue, type RenewData } from './vault.js'

export type VaultProfile = { readonly nickname: string | null; readonly avatarUrl: string | null }

/** Снимок сессии из SSR `load` или ответа POST-экшена. */
export type VaultPayload = RenewData

export interface UserVault {
  readonly authorized: boolean
  readonly principal: string | null
  readonly profile: VaultProfile
  readonly renewing: boolean
  /** Синхронизировать снимок корневого SSR `load` без затирания живого RAM. */
  syncServer(payload: VaultPayload | null | undefined): void
  /** Записать свежий снимок после входа, регистрации, смены профиля или продления. */
  hydrate(payload: VaultPayload): void
  /** Мгновенно очистить RAM во всех открытых вкладках (после выхода / отзыва сессии). */
  clear(): void
  /** Явно продлить временный токен по `HttpOnly`-куке `auth_sid`. */
  renew(force?: boolean): Promise<boolean>
  /** Дождаться свежего токена, если в RAM он уже истёк (после заморозки таймера). */
  ensureFresh(): Promise<boolean>
  /** Освободить таймер и `BroadcastChannel` (для тестовых экземпляров). */
  dispose(): void
}

export interface CreateVaultOptions {
  /** Имя канала `BroadcastChannel` для синхронизации вкладок (`null` — отключить). */
  channelName?: string | null
  /** Имя межвкладочного мьютекса `navigator.locks`. */
  lockName?: string
  /** Пользовательский отправитель `renew` (для изолированных unit-тестов). */
  postRenewTransport?: (signal: AbortSignal) => Promise<RenewPostOutcome>
  /** Пользовательский источник текущего времени (для детерминированных тестов). */
  now?: () => number
  /** Чтение SSR-снимка страницы до гидратации. */
  readSsrUser?: () => VaultPayload | null
}

export type RenewPostOutcome =
  | { readonly kind: 'ok'; readonly data: VaultPayload }
  | { readonly kind: 'revoked' }
  | { readonly kind: 'transient-error' }

const EMPTY_PROFILE: VaultProfile = Object.freeze({ nickname: null, avatarUrl: null })

const TERMINAL_AUTH_CODES = new Set([
  'auth.expired',
  'auth.revoked',
  'auth.session-unknown',
  'auth.blocked',
  'auth.delete-pending',
  'auth.deleted',
  'auth.token',
  'auth.kid-unknown',
])

type BroadcastMessage =
  | { readonly type: 'hydrate'; readonly payload: VaultPayload }
  | { readonly type: 'clear' }

function defaultReadSsrUser(): VaultPayload | null {
  try {
    return ((page.data as { user?: VaultPayload | null } | undefined)?.user ?? null)
  } catch {
    return null
  }
}

function resolveRenewTargetUrl(): string {
  try {
    const u = visibleAddress().url
    return (u.pathname || '/') + u.search
  } catch {
    return '/'
  }
}

async function defaultPostRenew(signal: AbortSignal): Promise<RenewPostOutcome> {
  const { seedEnvelope, seedEnvelopeFields } = await import('./ui/seed-form/envelope.js')
  const { kitActionTransport } = await import('#lib/components/form/transport.js')
  const envelope = seedEnvelope(`user-auth:${crypto.randomUUID()}`)
  const body = new FormData()
  for (const [k, v] of Object.entries(seedEnvelopeFields(envelope))) body.append(k, v)
  body.append('intent', 'renew')

  const out = await kitActionTransport(resolveRenewTargetUrl())({
    envelope,
    data: body,
    accept: ['application/json'],
    signal,
  })
  if (out.kind !== 'result') return { kind: 'transient-error' }

  if (!out.result.ok) {
    const failedCode =
      out.result.errors.find((m) => TERMINAL_AUTH_CODES.has(m.code))?.code ??
      ((out.result.data as { code?: string } | undefined)?.code)
    if (failedCode && TERMINAL_AUTH_CODES.has(failedCode)) {
      return { kind: 'revoked' }
    }
    return { kind: 'transient-error' }
  }

  const data = out.result.data as Partial<RenewData> | undefined
  if (
    typeof data?.access !== 'string' ||
    typeof data?.expiresAt !== 'number' ||
    typeof data?.ttlMs !== 'number' ||
    typeof data?.sub !== 'string'
  ) {
    return { kind: 'transient-error' }
  }

  return {
    kind: 'ok',
    data: {
      access: data.access,
      expiresAt: data.expiresAt,
      ttlMs: data.ttlMs,
      sub: data.sub,
      prof: data.prof ?? EMPTY_PROFILE,
    },
  }
}

export function createVault(options: CreateVaultOptions = {}): UserVault {
  const channelName = options.channelName === undefined ? 'modals-kit:user' : options.channelName
  const lockName = options.lockName ?? 'modals-kit:user:renew'
  const sendRenew = options.postRenewTransport ?? defaultPostRenew
  const now = options.now ?? (() => Date.now())
  const readSsrUser = options.readSsrUser ?? defaultReadSsrUser

  let access = $state<string | null>(null)
  let principal = $state<string | null>(null)
  let profile = $state<VaultProfile>(EMPTY_PROFILE)
  let renewing = $state(false)
  let synced = $state(false)

  let lastServerAccess: string | null | undefined = undefined
  let expiresAt = 0
  let ttlMs = 0
  let epoch = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let inflightAbort: AbortController | null = null
  let activeRenew: Promise<boolean> | null = null
  let channel: BroadcastChannel | null = null

  const isClientReady = (): boolean => typeof window !== 'undefined' && synced

  function cancelInflight(): void {
    if (inflightAbort) {
      inflightAbort.abort()
      inflightAbort = null
    }
  }

  function clearTimer(): void {
    if (timer !== undefined) {
      clearTimeout(timer)
      timer = undefined
    }
  }

  function schedule(): void {
    if (typeof window === 'undefined' || expiresAt === 0) return
    clearTimer()
    const delay = Math.max(0, fireAt(expiresAt, ttlMs) - now())
    timer = setTimeout(() => {
      void renew(false)
    }, delay)
  }

  function ensureChannel(): BroadcastChannel | null {
    if (channelName === null || typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') {
      return null
    }
    if (!channel) {
      channel = new BroadcastChannel(channelName)
      channel.addEventListener('message', (ev: Event) => {
        const msg = (ev as MessageEvent<BroadcastMessage>).data
        if (!msg || typeof msg !== 'object') return
        if (msg.type === 'hydrate' && msg.payload) {
          applyHydrate(msg.payload, false)
        } else if (msg.type === 'clear') {
          applyClear(false)
        }
      })
    }
    return channel
  }

  function applyHydrate(payload: VaultPayload, broadcast: boolean): void {
    epoch += 1
    cancelInflight()
    access = payload.access
    principal = payload.sub
    profile = {
      nickname: payload.prof.nickname ?? null,
      avatarUrl: payload.prof.avatarUrl ?? null,
    }
    expiresAt = payload.expiresAt
    ttlMs = payload.ttlMs
    if (typeof window !== 'undefined') synced = true
    schedule()
    if (broadcast) {
      ensureChannel()?.postMessage({ type: 'hydrate', payload } satisfies BroadcastMessage)
    }
  }

  function applyClear(broadcast: boolean): void {
    epoch += 1
    cancelInflight()
    clearTimer()
    access = null
    principal = null
    profile = EMPTY_PROFILE
    expiresAt = 0
    ttlMs = 0
    if (typeof window !== 'undefined') synced = true
    if (broadcast) {
      ensureChannel()?.postMessage({ type: 'clear' } satisfies BroadcastMessage)
    }
  }

  async function executeLockedRenew(force: boolean): Promise<boolean> {
    // Уступаем один макротик очереди MessagePort, чтобы `BroadcastChannel.postMessage`
    // от вкладки, только что освободившей Web Lock, успел доставиться до проверки `expiresAt`.
    await new Promise((r) => setTimeout(r, 0))
    // Соседняя вкладка уже обновила пару и прислала свежий `expiresAt` через BroadcastChannel:
    // второй сетевой запрос не нужен.
    if (!force && expiresAt !== 0 && now() < expiresAt - leadFor(ttlMs)) {
      schedule()
      return true
    }

    const myEpoch = epoch
    const ac = new AbortController()
    inflightAbort = ac
    try {
      const outcome = await sendRenew(ac.signal)
      // Пока запрос летел, пользователь вышел или обновил профиль — старый ответ отбрасываем.
      if (myEpoch !== epoch) return access !== null

      if (outcome.kind === 'ok') {
        applyHydrate(outcome.data, true)
        return true
      }
      if (outcome.kind === 'revoked') {
        applyClear(true)
        return false
      }
      return false
    } catch {
      return false
    } finally {
      if (inflightAbort === ac) inflightAbort = null
    }
  }

  function renew(force = false): Promise<boolean> {
    if (typeof window === 'undefined' || access === null) return Promise.resolve(false)
    if (activeRenew) return activeRenew

    ensureChannel()
    renewing = true
    const run = (async (): Promise<boolean> => {
      try {
        const nav = navigator as Navigator & { locks?: LockManager }
        if (nav.locks) {
          return await nav.locks.request(lockName, () => executeLockedRenew(force))
        }
        return await executeLockedRenew(force)
      } finally {
        renewing = false
        activeRenew = null
      }
    })()

    activeRenew = run
    return run
  }

  async function ensureFresh(): Promise<boolean> {
    if (typeof window === 'undefined' || access === null) return false
    if (expiresAt === 0 || !overdue(expiresAt, now())) return true
    return renew(true)
  }

  if (typeof window !== 'undefined') {
    ensureChannel()
    const onWake = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      if (access !== null && expiresAt !== 0 && overdue(expiresAt, now())) {
        void ensureFresh()
      }
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onWake)
    }
    window.addEventListener('online', onWake)
  }

  return {
    get authorized(): boolean {
      if (!isClientReady()) return readSsrUser() !== null
      return principal !== null
    },
    get principal(): string | null {
      if (!isClientReady()) return readSsrUser()?.sub ?? null
      return principal
    },
    get profile(): VaultProfile {
      if (!isClientReady()) return readSsrUser()?.prof ?? EMPTY_PROFILE
      return profile
    },
    get renewing(): boolean {
      return renewing
    },
    syncServer(payload: VaultPayload | null | undefined): void {
      ensureChannel()
      const nextAccess = payload?.access ?? null
      if (lastServerAccess === nextAccess) {
        if (typeof window !== 'undefined') synced = true
        return
      }
      lastServerAccess = nextAccess
      if (payload) {
        if (!access || access !== nextAccess) applyHydrate(payload, false)
        else if (typeof window !== 'undefined') synced = true
      } else {
        applyClear(false)
      }
    },
    hydrate(payload: VaultPayload): void {
      applyHydrate(payload, true)
    },
    clear(): void {
      applyClear(true)
    },
    renew,
    ensureFresh,
    dispose(): void {
      cancelInflight()
      clearTimer()
      if (channel) {
        channel.close()
        channel = null
      }
    },
  }
}

/** Единственный экземпляр `vault` текущей вкладки. */
export const vault: UserVault = createVault()

if (typeof window !== 'undefined') {
  setFormSessionInterceptor({
    ensureFresh: () => vault.ensureFresh(),
    onAuthExpired: () => vault.renew(true),
  })
}
