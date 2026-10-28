// Ограничитель параллельных потоков (`concurrency`: `reject` | `queue` | `preempt`)
// с поддержкой областей `'global' | 'ip' | 'client'` и мягкой деградацией в `console.error`.

import { reportDegradedOption, type StorageRequestMeta } from './store.js'

export type ConcurrencyMode = 'reject' | 'queue' | 'preempt'
export type ConcurrencyScope = 'global' | 'ip' | 'client'

export interface ConcurrencyConfig {
  readonly max: number
  readonly mode?: ConcurrencyMode
  readonly scope?: ConcurrencyScope
  readonly queueTimeoutMs?: number
}

export type ConcurrencyInput = number | ConcurrencyConfig | null | undefined

export class StorageConcurrencyError extends Error {
  readonly code = 'STORAGE_CONCURRENCY_LIMIT'
  readonly status = 429
  readonly server: string
  constructor(server: string, max: number, scope: ConcurrencyScope) {
    super(
      `[storage] превышен лимит параллельных потоков сервера «${server}» (max=${max}, scope=${scope})`,
    )
    this.name = 'StorageConcurrencyError'
    this.server = server
  }
}

export interface ConcurrencyLease {
  /** Сигнал, который срабатывает при вытеснении потока (`mode: 'preempt'`) или внешнем `AbortSignal`. */
  readonly signal: AbortSignal
  release(): void
}

interface ActiveSlot {
  readonly id: number
  readonly controller: AbortController
  released: boolean
}

interface Waiter {
  resolve(slot: ActiveSlot): void
  reject(err: unknown): void
  cleanup(): void
}

export interface ConcurrencyGate {
  readonly config: Required<ConcurrencyConfig>
  acquire(options?: {
    meta?: StorageRequestMeta
    signal?: AbortSignal
  }): Promise<ConcurrencyLease>
  activeCount(bucketKey?: string): number
}

const DEFAULT_QUEUE_TIMEOUT_MS = 30_000

export function normalizeConcurrencyConfig(
  input: ConcurrencyInput,
): Required<ConcurrencyConfig> | null {
  if (input === undefined || input === null || input === 0) return null
  if (typeof input === 'number') {
    if (!Number.isInteger(input) || input < 1) {
      throw new RangeError(`[storage/concurrency] max обязан быть целым >= 1 (получено ${input})`)
    }
    return {
      max: input,
      mode: 'reject',
      scope: 'global',
      queueTimeoutMs: DEFAULT_QUEUE_TIMEOUT_MS,
    }
  }
  if (!Number.isInteger(input.max) || input.max < 1) {
    throw new RangeError(
      `[storage/concurrency] concurrency.max обязан быть целым >= 1 (получено ${input.max})`,
    )
  }
  return {
    max: input.max,
    mode: input.mode ?? 'reject',
    scope: input.scope ?? 'global',
    queueTimeoutMs: input.queueTimeoutMs ?? DEFAULT_QUEUE_TIMEOUT_MS,
  }
}

const NOOP_LEASE: ConcurrencyLease = {
  signal: new AbortController().signal,
  release() {},
}

export function createConcurrencyGate(
  serverName: string,
  config: Required<ConcurrencyConfig>,
): ConcurrencyGate {
  let seq = 0
  const buckets = new Map<
    string,
    { active: ActiveSlot[]; queue: Waiter[] }
  >()

  function getBucket(key: string) {
    let b = buckets.get(key)
    if (!b) {
      b = { active: [], queue: [] }
      buckets.set(key, b)
    }
    return b
  }

  function resolveScopeKey(meta?: StorageRequestMeta): string | null {
    if (config.scope === 'global') return 'global'
    if (config.scope === 'ip') {
      const ip = meta?.ip?.trim()
      if (!ip) {
        reportDegradedOption(
          `concurrency.scope="ip" (сервер «${serverName}»)`,
          'meta.ip (или tech.resolveMeta)',
        )
        return null
      }
      return `ip:${ip}`
    }
    const clientId = meta?.clientId?.trim()
    if (!clientId) {
      reportDegradedOption(
        `concurrency.scope="client" (сервер «${serverName}»)`,
        'meta.clientId (или tech.resolveMeta)',
      )
      return null
    }
    return `client:${clientId}`
  }

  function makeLease(bucketKey: string, slot: ActiveSlot, outerSignal?: AbortSignal): ConcurrencyLease {
    const onOuterAbort = () => {
      slot.controller.abort(
        outerSignal?.reason instanceof Error
          ? outerSignal.reason
          : new DOMException('Aborted', 'AbortError'),
      )
    }
    if (outerSignal) {
      if (outerSignal.aborted) onOuterAbort()
      else outerSignal.addEventListener('abort', onOuterAbort, { once: true })
    }

    return {
      signal: slot.controller.signal,
      release() {
        if (slot.released) return
        slot.released = true
        outerSignal?.removeEventListener('abort', onOuterAbort)

        const bucket = buckets.get(bucketKey)
        if (!bucket) return
        const idx = bucket.active.indexOf(slot)
        if (idx !== -1) bucket.active.splice(idx, 1)

        while (bucket.queue.length > 0 && bucket.active.length < config.max) {
          const nextWaiter = bucket.queue.shift()!
          nextWaiter.cleanup()
          const nextSlot: ActiveSlot = {
            id: ++seq,
            controller: new AbortController(),
            released: false,
          }
          bucket.active.push(nextSlot)
          nextWaiter.resolve(nextSlot)
        }

        if (bucket.active.length === 0 && bucket.queue.length === 0) {
          buckets.delete(bucketKey)
        }
      },
    }
  }

  return {
    config,

    activeCount(bucketKey = 'global'): number {
      return buckets.get(bucketKey)?.active.length ?? 0
    },

    async acquire(options): Promise<ConcurrencyLease> {
      options?.signal?.throwIfAborted()
      const bucketKey = resolveScopeKey(options?.meta)
      if (bucketKey === null) {
        return options?.signal
          ? { signal: options.signal, release() {} }
          : NOOP_LEASE
      }

      const bucket = getBucket(bucketKey)
      if (bucket.active.length < config.max) {
        const slot: ActiveSlot = {
          id: ++seq,
          controller: new AbortController(),
          released: false,
        }
        bucket.active.push(slot)
        return makeLease(bucketKey, slot, options?.signal)
      }

      if (config.mode === 'preempt') {
        const oldest = bucket.active.shift()
        if (oldest) {
          oldest.released = true
          oldest.controller.abort(
            new StorageConcurrencyError(serverName, config.max, config.scope),
          )
        }
        const slot: ActiveSlot = {
          id: ++seq,
          controller: new AbortController(),
          released: false,
        }
        bucket.active.push(slot)
        return makeLease(bucketKey, slot, options?.signal)
      }

      if (config.mode === 'reject') {
        throw new StorageConcurrencyError(serverName, config.max, config.scope)
      }

      // mode === 'queue'
      const slot = await new Promise<ActiveSlot>((resolve, reject) => {
        const timer = setTimeout(() => {
          const idx = bucket.queue.indexOf(waiter)
          if (idx !== -1) bucket.queue.splice(idx, 1)
          waiter.cleanup()
          reject(new StorageConcurrencyError(serverName, config.max, config.scope))
        }, config.queueTimeoutMs)

        const onAbort = () => {
          const idx = bucket.queue.indexOf(waiter)
          if (idx !== -1) bucket.queue.splice(idx, 1)
          waiter.cleanup()
          reject(
            options?.signal?.reason instanceof Error
              ? options.signal.reason
              : new DOMException('Aborted', 'AbortError'),
          )
        }

        const waiter: Waiter = {
          resolve,
          reject,
          cleanup() {
            clearTimeout(timer)
            options?.signal?.removeEventListener('abort', onAbort)
          },
        }

        options?.signal?.addEventListener('abort', onAbort, { once: true })
        bucket.queue.push(waiter)
      })

      return makeLease(bucketKey, slot, options?.signal)
    },
  }
}

export function resolveCallConcurrency(
  serverName: string,
  serverGate: ConcurrencyGate | null,
  callConcurrency: ConcurrencyInput,
): ConcurrencyGate | null {
  if (callConcurrency === undefined) return serverGate
  if (callConcurrency === null || callConcurrency === 0) return null
  const cfg = normalizeConcurrencyConfig(callConcurrency)
  return cfg ? createConcurrencyGate(serverName, cfg) : null
}

/** Привязать освобождение слота `ConcurrencyLease` к полному чтению или отмене `ReadableStream`. */
export function bindStreamLease<T extends Uint8Array>(
  stream: ReadableStream<T>,
  lease: ConcurrencyLease,
): ReadableStream<Uint8Array<ArrayBuffer>> {
  let reader: ReadableStreamDefaultReader<T> | null = null
  let released = false

  let streamController: ReadableStreamDefaultController<Uint8Array<ArrayBuffer>> | null = null

  function doneOnce() {
    if (!released) {
      released = true
      lease.release()
    }
  }

  const onAbort = () => {
    const reason =
      lease.signal.reason instanceof Error
        ? lease.signal.reason
        : new DOMException('Aborted', 'AbortError')
    if (reader) {
      void reader.cancel(reason).catch(() => undefined)
    }
    doneOnce()
    try {
      streamController?.error(reason)
    } catch {
      // Поток уже закрыт или переведён в ошибку
    }
  }

  return new ReadableStream<Uint8Array<ArrayBuffer>>({
    start(controller) {
      streamController = controller
      if (lease.signal.aborted) {
        onAbort()
      } else {
        lease.signal.addEventListener('abort', onAbort, { once: true })
      }
    },
    async pull(controller) {
      try {
        lease.signal.throwIfAborted()
        if (!reader) {
          reader = stream.getReader()
        }
        const { done, value } = await reader.read()
        lease.signal.throwIfAborted()
        if (done) {
          lease.signal.removeEventListener('abort', onAbort)
          reader.releaseLock()
          reader = null
          doneOnce()
          controller.close()
          return
        }
        const copy = new Uint8Array(new ArrayBuffer(value.byteLength))
        copy.set(value)
        controller.enqueue(copy)
      } catch (err) {
        lease.signal.removeEventListener('abort', onAbort)
        if (reader) {
          await reader.cancel(err).catch(() => undefined)
          reader.releaseLock()
          reader = null
        }
        doneOnce()
        try {
          controller.error(err)
        } catch {
          // Контроллер уже переведён в состояние ошибки через onAbort
        }
      }
    },
    async cancel(reason) {
      lease.signal.removeEventListener('abort', onAbort)
      if (reader) {
        await reader.cancel(reason).catch(() => undefined)
        reader.releaseLock()
        reader = null
      }
      doneOnce()
    },
  })
}
