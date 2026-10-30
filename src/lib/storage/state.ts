// Необязательный коллектор телеметрии `#lib/storage/state.js` (§1.2 спецификации).
//
// 0 зависимостей от фреймворков: отдаёт синхронный `getSnapshot()` и `subscribe(listener)`.

export type StorageStateEvent =
  | { readonly type: 'upload:start'; readonly server: string; readonly path: string }
  | {
      readonly type: 'upload:done'
      readonly server: string
      readonly path: string
      readonly bytes: number
    }
  | {
      readonly type: 'upload:error'
      readonly server: string
      readonly path: string
      readonly error: string
    }
  | { readonly type: 'download:start'; readonly server: string; readonly path: string }
  | {
      readonly type: 'download:done'
      readonly server: string
      readonly path: string
      readonly bytes: number
    }
  | {
      readonly type: 'download:error'
      readonly server: string
      readonly path: string
      readonly error: string
    }
  | {
      readonly type: 'server:cooldown'
      readonly server: string
      readonly until: number
      readonly error: string
    }
  | {
      readonly type: 'server:recovered'
      readonly server: string
    }
  | {
      readonly type: 'file:missing'
      readonly server: string
      readonly path: string
      readonly missingCount: number
    }
  | {
      readonly type: 'file:restored'
      readonly server: string
      readonly path: string
    }
  | {
      readonly type: 'server:suspended'
      readonly server: string
      readonly reason: 'missing-files' | 'manual'
      readonly missingCount: number
    }
  | {
      readonly type: 'server:resumed'
      readonly server: string
    }

export type StorageStateListener = (event: StorageStateEvent) => void

export interface ServerTelemetrySnapshot {
  readonly activeUploads: number
  readonly activeDownloads: number
  readonly bytesWritten: number
  readonly bytesRead: number
  readonly errorsCount: number
  readonly missingCount: number
  readonly suspended: boolean
  readonly suspendedReason?: 'missing-files' | 'manual'
  readonly lastError?: string
  readonly cooldownUntil?: number
}

export interface StorageTelemetrySnapshot {
  readonly activeUploads: number
  readonly activeDownloads: number
  readonly bytesWritten: number
  readonly bytesRead: number
  readonly errorsCount: number
  readonly servers: Readonly<Record<string, ServerTelemetrySnapshot>>
}

export interface StorageStateCollector {
  readonly onEvent: StorageStateListener
  getSnapshot(): StorageTelemetrySnapshot
  subscribe(listener: (snapshot: StorageTelemetrySnapshot) => void): () => void
  reset(): void
}

interface MutableServerStats {
  activeUploads: number
  activeDownloads: number
  bytesWritten: number
  bytesRead: number
  errorsCount: number
  missingCount: number
  suspended: boolean
  suspendedReason?: 'missing-files' | 'manual'
  lastError?: string
  cooldownUntil?: number
}

export function createStorageState(): StorageStateCollector {
  const perServer = new Map<string, MutableServerStats>()
  const subscribers = new Set<(snapshot: StorageTelemetrySnapshot) => void>()

  function ensure(server: string): MutableServerStats {
    let s = perServer.get(server)
    if (!s) {
      s = {
        activeUploads: 0,
        activeDownloads: 0,
        bytesWritten: 0,
        bytesRead: 0,
        errorsCount: 0,
        missingCount: 0,
        suspended: false,
      }
      perServer.set(server, s)
    }
    return s
  }

  function snapshot(): StorageTelemetrySnapshot {
    let activeUploads = 0
    let activeDownloads = 0
    let bytesWritten = 0
    let bytesRead = 0
    let errorsCount = 0
    const servers: Record<string, ServerTelemetrySnapshot> = {}

    for (const [name, s] of perServer) {
      activeUploads += s.activeUploads
      activeDownloads += s.activeDownloads
      bytesWritten += s.bytesWritten
      bytesRead += s.bytesRead
      errorsCount += s.errorsCount
      servers[name] = {
        activeUploads: s.activeUploads,
        activeDownloads: s.activeDownloads,
        bytesWritten: s.bytesWritten,
        bytesRead: s.bytesRead,
        errorsCount: s.errorsCount,
        missingCount: s.missingCount,
        suspended: s.suspended,
        ...(s.suspendedReason !== undefined ? { suspendedReason: s.suspendedReason } : {}),
        ...(s.lastError !== undefined ? { lastError: s.lastError } : {}),
        ...(s.cooldownUntil !== undefined ? { cooldownUntil: s.cooldownUntil } : {}),
      }
    }

    return {
      activeUploads,
      activeDownloads,
      bytesWritten,
      bytesRead,
      errorsCount,
      servers,
    }
  }

  function notify() {
    if (subscribers.size === 0) return
    const snap = snapshot()
    for (const fn of subscribers) fn(snap)
  }

  return {
    onEvent(ev: StorageStateEvent) {
      const s = ensure(ev.server)
      switch (ev.type) {
        case 'upload:start':
          s.activeUploads += 1
          break
        case 'upload:done':
          s.activeUploads = Math.max(0, s.activeUploads - 1)
          s.bytesWritten += ev.bytes
          break
        case 'upload:error':
          s.activeUploads = Math.max(0, s.activeUploads - 1)
          s.errorsCount += 1
          s.lastError = ev.error
          break
        case 'download:start':
          s.activeDownloads += 1
          break
        case 'download:done':
          s.activeDownloads = Math.max(0, s.activeDownloads - 1)
          s.bytesRead += ev.bytes
          break
        case 'download:error':
          s.activeDownloads = Math.max(0, s.activeDownloads - 1)
          s.errorsCount += 1
          s.lastError = ev.error
          break
        case 'server:cooldown':
          s.cooldownUntil = ev.until
          s.lastError = ev.error
          break
        case 'server:recovered':
          delete s.cooldownUntil
          break
        case 'file:missing':
          s.missingCount = ev.missingCount
          break
        case 'file:restored':
          s.missingCount = Math.max(0, s.missingCount - 1)
          break
        case 'server:suspended':
          s.suspended = true
          s.suspendedReason = ev.reason
          s.missingCount = ev.missingCount
          break
        case 'server:resumed':
          s.suspended = false
          delete s.suspendedReason
          break
      }
      notify()
    },

    getSnapshot: snapshot,

    subscribe(listener) {
      subscribers.add(listener)
      return () => {
        subscribers.delete(listener)
      }
    },

    reset() {
      perServer.clear()
      notify()
    },
  }
}
