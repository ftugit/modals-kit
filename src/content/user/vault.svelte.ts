/**
 * Vault — единый реактивный стор сессии вкладки на лексическом замыкании.
 *
 * Архитектурные инварианты (`src/content/user/README.md`):
 * 1. Оба криптографических токена (`auth_sid` и `auth_tmp`) живут строго в `HttpOnly`-куках
 *    и никогда не сериализуются в HTML страницы, JSON или `BroadcastChannel`.
 * 2. В приватном лексическом замыкании `createVault()` хранятся исключительно
 *    публичные метаданные сессии (`sub`, `prof`, `iat`, `expiresAt`, `ttlMs`, `epoch`).
 *    Снаружи доступны только read-only геттеры (`authorized`, `principal`,
 *    `profile`, `renewing`) и методы жизненного цикла.
 * 3. Бесшовный SSR без `readUser`: до первой инициализации вкладки геттеры читают
 *    `page.data.user`, а после — реактивные `$state`-переменные замыкания; авторитетный
 *    штамп серверного вызова `authStamp` исключает как затирание живого RAM старым
 *    кэшем layout'а при клиентских переходах, так и игнорирование реального ответа
 *    сервера `null` при отзыве сессии.
 * 4. Детерминированная межвкладочная координация без тайминговых хаков:
 *    `5%`-й джиттер + `navigator.locks` + синхронное зеркало `localStorage` +
 *    `BroadcastChannel('modals-kit:user')` гарантируют ровно `1` сетевой `POST`
 *    даже при одновременном пробуждении произвольного числа вкладок; счётчик
 *    поколений `epoch` и `AbortController` отсекают запоздавшие ответы.
 * 5. Все глобальные слушатели (`visibilitychange`, `online`, `storage`) снимаются
 *    при `dispose()` и перезагрузке модуля HMR.
 */
import { page } from '$app/state'
import { visibleAddress } from '#lib/address/sveltekit.js'
import {
  fireAt,
  leadFor,
  overdue,
  snapshotKeyOf,
  type RenewData,
  type VaultProfile,
  type VaultSessionMeta,
} from './vault.js'

export type { VaultProfile, VaultSessionMeta }

/** Снимок метаданных сессии из SSR `load` или ответа POST-экшена. */
export type VaultPayload = VaultSessionMeta

export interface UserVault {
  readonly authorized: boolean
  readonly principal: string | null
  readonly profile: VaultProfile
  readonly renewing: boolean
  /**
   * Синхронизировать снимок корневого SSR `load`:
   * - `serverStamp` меняется на сервере только при реальном перезапуске `+layout.server.ts`,
   *   поэтому старый кэш layout'а на клиентских переходах не затирает RAM, а свежий ответ
   *   сервера (включая `null` после отзыва сессии) применяется безоговорочно.
   */
  syncServer(payload: VaultPayload | null | undefined, serverStamp?: number): void
  /** Записать свежий снимок после входа, регистрации, смены профиля или продления. */
  hydrate(payload: VaultPayload): void
  /** Мгновенно очистить RAM во всех открытых вкладках (после выхода / отзыва сессии). */
  clear(): void
  /** Явно продлить временный токен по `HttpOnly`-куке `auth_sid`. */
  renew(force?: boolean): Promise<boolean>
  /** Дождаться свежего токена, если в RAM он уже истёк (после заморозки таймера). */
  ensureFresh(): Promise<boolean>
  /** Освободить таймер, `BroadcastChannel` и все DOM/window-слушатели. */
  dispose(): void
}

export interface CreateVaultOptions {
  /** Имя канала `BroadcastChannel` и ключа `localStorage` (`null` — изолированный режим). */
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

type SharedEnvelope =
  | { readonly seq: number; readonly type: 'hydrate'; readonly payload: VaultPayload }
  | { readonly seq: number; readonly type: 'clear' }

function isValidPayload(data: unknown): data is VaultPayload {
  if (!data || typeof data !== 'object') return false
  const d = data as Partial<RenewData>
  return (
    typeof d.sub === 'string' &&
    typeof d.iat === 'number' &&
    typeof d.expiresAt === 'number' &&
    typeof d.ttlMs === 'number'
  )
}

function normalizePayload(data: RenewData): VaultPayload {
  return {
    sub: data.sub,
    iat: data.iat,
    expiresAt: data.expiresAt,
    ttlMs: data.ttlMs,
    prof: {
      nickname: data.prof?.nickname ?? null,
      avatarUrl: data.prof?.avatarUrl ?? null,
    },
  }
}

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
  const { kitActionTransport } = await import('#hooks/component-form/transport.js')
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

  if (!isValidPayload(out.result.data)) return { kind: 'transient-error' }
  return { kind: 'ok', data: normalizePayload(out.result.data) }
}

export function createVault(options: CreateVaultOptions = {}): UserVault {
  const channelName = options.channelName === undefined ? 'modals-kit:user' : options.channelName
  const storageKey = channelName ? `${channelName}:meta` : null
  const lockName = options.lockName ?? 'modals-kit:user:renew'
  const sendRenew = options.postRenewTransport ?? defaultPostRenew
  const now = options.now ?? (() => Date.now())
  const readSsrUser = options.readSsrUser ?? defaultReadSsrUser

  let principal = $state<string | null>(null)
  let profile = $state<VaultProfile>(EMPTY_PROFILE)
  let renewing = $state(false)
  let synced = $state(false)

  let iat = 0
  let expiresAt = 0
  let ttlMs = 0
  let epoch = 0
  let sharedSeq = 0
  let lastServerMarker: string | number | undefined = undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let inflightAbort: AbortController | null = null
  let activeRenew: Promise<boolean> | null = null
  let channel: BroadcastChannel | null = null
  const cleanups: Array<() => void> = []

  const isClientReady = (): boolean => typeof window !== 'undefined' && synced

  function readSharedEnvelope(): SharedEnvelope | undefined {
    if (!storageKey || typeof window === 'undefined') return undefined
    try {
      const raw = window.localStorage.getItem(storageKey)
      if (!raw) return undefined
      const parsed = JSON.parse(raw) as Partial<SharedEnvelope>
      if (typeof parsed?.seq !== 'number') return undefined
      if (parsed.type === 'clear') return { seq: parsed.seq, type: 'clear' }
      if (parsed.type === 'hydrate' && isValidPayload(parsed.payload)) {
        return { seq: parsed.seq, type: 'hydrate', payload: normalizePayload(parsed.payload) }
      }
      return undefined
    } catch {
      return undefined
    }
  }

  function nextSharedSeq(): number {
    const stored = readSharedEnvelope()?.seq ?? 0
    sharedSeq = Math.max(sharedSeq, stored) + 1
    return sharedSeq
  }

  function publishShared(envelope: SharedEnvelope): void {
    if (storageKey && typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(envelope))
      } catch {
        /* приватный режим / запрет storage — остаётся BroadcastChannel */
      }
    }
    ensureChannel()?.postMessage(envelope)
  }

  function acceptSharedEnvelope(envelope: SharedEnvelope | undefined): void {
    if (!envelope || envelope.seq <= sharedSeq) return
    sharedSeq = envelope.seq
    if (envelope.type === 'hydrate') {
      applyHydrate(envelope.payload, false)
    } else {
      applyClear(false)
    }
  }

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
    if (typeof window === 'undefined' || principal === null || expiresAt === 0) return
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
        const msg = (ev as MessageEvent<SharedEnvelope>).data
        if (!msg || typeof msg !== 'object' || typeof msg.seq !== 'number') return
        // Сверяем с актуальным конвертом в storage на случай out-of-order доставки IPC:
        const latest = readSharedEnvelope()
        if (latest && latest.seq > msg.seq) {
          acceptSharedEnvelope(latest)
          return
        }
        if (msg.type === 'hydrate' && isValidPayload(msg.payload)) {
          acceptSharedEnvelope({ seq: msg.seq, type: 'hydrate', payload: normalizePayload(msg.payload) })
        } else if (msg.type === 'clear') {
          acceptSharedEnvelope({ seq: msg.seq, type: 'clear' })
        }
      })
    }
    return channel
  }

  function applyHydrate(payload: VaultPayload, broadcast: boolean): void {
    epoch += 1
    cancelInflight()
    principal = payload.sub
    iat = payload.iat
    expiresAt = payload.expiresAt
    ttlMs = payload.ttlMs
    profile = {
      nickname: payload.prof.nickname ?? null,
      avatarUrl: payload.prof.avatarUrl ?? null,
    }
    if (typeof window !== 'undefined') synced = true
    schedule()
    if (broadcast) {
      publishShared({ seq: nextSharedSeq(), type: 'hydrate', payload })
    }
  }

  function applyClear(broadcast: boolean): void {
    epoch += 1
    cancelInflight()
    clearTimer()
    principal = null
    iat = 0
    expiresAt = 0
    ttlMs = 0
    profile = EMPTY_PROFILE
    if (typeof window !== 'undefined') synced = true
    if (broadcast) {
      publishShared({ seq: nextSharedSeq(), type: 'clear' })
    }
  }

  /**
   * Синхронная сверка с монотонным Lamport-конвертом в `localStorage` под `navigator.locks`
   * (`0 мс`, без `setTimeout` и без гонок с асинхронной очередью `BroadcastChannel`).
   */
  function syncFromSharedStorageUnderLock(): void {
    acceptSharedEnvelope(readSharedEnvelope())
  }

  async function executeLockedRenew(force: boolean, epochBeforeLock: number): Promise<boolean> {
    syncFromSharedStorageUnderLock()

    // Пока вкладка ждала `navigator.locks`, соседняя вкладка уже обновила или закрыла сессию:
    if (epoch !== epochBeforeLock) {
      if (principal === null) return false
      if (!overdue(expiresAt, now())) {
        schedule()
        return true
      }
    }

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
      if (myEpoch !== epoch) return principal !== null

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
    if (typeof window === 'undefined' || principal === null) return Promise.resolve(false)
    if (activeRenew) return activeRenew

    ensureChannel()
    const epochBeforeLock = epoch
    renewing = true
    const run = (async (): Promise<boolean> => {
      try {
        const nav = navigator as Navigator & { locks?: LockManager }
        if (nav.locks) {
          return await nav.locks.request(lockName, () => executeLockedRenew(force, epochBeforeLock))
        }
        return await executeLockedRenew(force, epochBeforeLock)
      } finally {
        renewing = false
        activeRenew = null
      }
    })()

    activeRenew = run
    return run
  }

  async function ensureFresh(): Promise<boolean> {
    if (typeof window === 'undefined' || principal === null) return false
    if (expiresAt === 0 || !overdue(expiresAt, now())) return true
    return renew(true)
  }

  if (typeof window !== 'undefined') {
    ensureChannel()
    const onWake = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      if (principal !== null && expiresAt !== 0 && overdue(expiresAt, now())) {
        void ensureFresh()
      }
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onWake)
      cleanups.push(() => document.removeEventListener('visibilitychange', onWake))
    }
    window.addEventListener('online', onWake)
    cleanups.push(() => window.removeEventListener('online', onWake))
    // Второй канал координации — `storage`-событие того же ключа, что пишет
    // `publishShared`. Он нужен там, где `BroadcastChannel` недоступен (старые
    // Safari, часть webview) и когда вкладку не удаётся разбудить `IPC`; без него
    // при живом `localStorage` вкладки расходились бы до следующего `visibilitychange`.
    // Дедупликация — по `seq` конверта (`acceptSharedEnvelope`), поэтому двойная
    // доставка `storage` + `BroadcastChannel` ничего не ломает.
    if (storageKey) {
      const onStorage = (e: StorageEvent) => {
        if (e.key !== storageKey) return
        acceptSharedEnvelope(readSharedEnvelope())
      }
      window.addEventListener('storage', onStorage)
      cleanups.push(() => window.removeEventListener('storage', onStorage))
    }
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
    syncServer(payload: VaultPayload | null | undefined, serverStamp?: number): void {
      ensureChannel()
      const marker = serverStamp !== undefined ? serverStamp : snapshotKeyOf(payload)
      if (lastServerMarker === marker) {
        if (typeof window !== 'undefined') synced = true
        return
      }
      lastServerMarker = marker
      if (payload) {
        const normalized = normalizePayload(payload)
        const currentKey = principal
          ? snapshotKeyOf({ sub: principal, iat, expiresAt, ttlMs, prof: profile })
          : 'guest'
        if (currentKey !== snapshotKeyOf(normalized)) applyHydrate(normalized, false)
        else if (typeof window !== 'undefined') synced = true
      } else {
        applyClear(false)
      }
    },
    hydrate(payload: VaultPayload): void {
      const normalized = normalizePayload(payload)
      if (typeof lastServerMarker === 'string') {
        lastServerMarker = snapshotKeyOf(normalized)
      }
      applyHydrate(normalized, true)
    },
    clear(): void {
      if (typeof lastServerMarker === 'string') {
        lastServerMarker = 'guest'
      }
      applyClear(true)
    },
    renew,
    ensureFresh,
    dispose(): void {
      cancelInflight()
      clearTimer()
      for (const fn of cleanups.splice(0)) fn()
      if (channel) {
        channel.close()
        channel = null
      }
    },
  }
}

/** Единственный экземпляр `vault` текущей вкладки. */
export const vault: UserVault = createVault()

/** Явный адаптер защиты сессии для форм модуля пользователя (`bindComponentForm(..., { session: userSession })`). */
export const userSession = {
  ensureFresh: () => vault.ensureFresh(),
  onAuthExpired: () => vault.renew(true),
} as const

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    vault.dispose()
  })
}
