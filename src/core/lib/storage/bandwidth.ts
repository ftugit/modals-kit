// Двусторонний потоковый ограничитель полосы пропускания (`rate`: байт/сек).
//
// Нарезка крупных чанков до `<= 32 КиБ` и точное дозирование через token-bucket,
// с мгновенным прерыванием ожидания по `AbortSignal`.

const MAX_SLICE_BYTES = 32 * 1024

export interface BandwidthLimiter {
  readonly rateBytesPerSec: number
  throttle(
    stream: ReadableStream<Uint8Array>,
    signal?: AbortSignal,
  ): ReadableStream<Uint8Array<ArrayBuffer>>
}

function sleepAbortable(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(
        signal.reason instanceof Error
          ? signal.reason
          : new DOMException('Aborted', 'AbortError'),
      )
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    function onAbort() {
      clearTimeout(timer)
      reject(
        signal?.reason instanceof Error
          ? signal.reason
          : new DOMException('Aborted', 'AbortError'),
      )
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Создать разделяемый token-bucket лимитер скорости (`bytesPerSec`).
 * Если один экземпляр передан в конфиг сервера — все параллельные потоки этого сервера делят общую полосу!
 */
export function createBandwidthLimiter(rateBytesPerSec: number): BandwidthLimiter {
  if (!Number.isFinite(rateBytesPerSec) || rateBytesPerSec <= 0) {
    throw new RangeError(
      `[storage/bandwidth] rateBytesPerSec обязан быть положительным числом (получено ${rateBytesPerSec})`,
    )
  }

  // Начальный burst ограничен 50 мс полосы (или минимум 4 КиБ), чтобы короткие тесты и потоки шли плавно
  const burstCap = Math.max(4096, Math.floor(rateBytesPerSec * 0.05))
  let availableTokens = burstCap
  let lastRefillMs = performance.now()
  let chain: Promise<void> = Promise.resolve()

  function consumeTokens(bytes: number, signal?: AbortSignal): Promise<void> {
    const step = chain.then(async () => {
      signal?.throwIfAborted()
      const now = performance.now()
      const elapsedSec = Math.max(0, (now - lastRefillMs) / 1000)
      availableTokens = Math.min(
        burstCap,
        availableTokens + elapsedSec * rateBytesPerSec,
      )
      lastRefillMs = now

      if (availableTokens >= bytes) {
        availableTokens -= bytes
        return
      }

      const deficit = bytes - availableTokens
      availableTokens = 0
      const waitMs = Math.ceil((deficit / rateBytesPerSec) * 1000)
      await sleepAbortable(waitMs, signal)
      lastRefillMs = performance.now()
    })
    chain = step.catch(() => undefined)
    return step
  }

  return {
    rateBytesPerSec,

    throttle(
      stream: ReadableStream<Uint8Array>,
      signal?: AbortSignal,
    ): ReadableStream<Uint8Array<ArrayBuffer>> {
      let reader: ReadableStreamDefaultReader<Uint8Array> | null = null
      let pending: Uint8Array | null = null
      const sliceLimit = Math.max(1024, Math.min(MAX_SLICE_BYTES, Math.ceil(rateBytesPerSec / 10)))

      return new ReadableStream<Uint8Array<ArrayBuffer>>({
        async pull(controller) {
          try {
            signal?.throwIfAborted()
            if (!reader) reader = stream.getReader()

            while (!pending || pending.byteLength === 0) {
              const next = await reader.read()
              if (next.done) {
                reader.releaseLock()
                reader = null
                controller.close()
                return
              }
              if (next.value.byteLength > 0) {
                pending = next.value
              }
            }

            const take = Math.min(sliceLimit, pending.byteLength)
            await consumeTokens(take, signal)
            const chunk = new Uint8Array(new ArrayBuffer(take))
            chunk.set(pending.subarray(0, take))
            pending = take < pending.byteLength ? pending.subarray(take) : null
            controller.enqueue(chunk)
          } catch (err) {
            if (reader) {
              await reader.cancel(err).catch(() => undefined)
              reader.releaseLock()
              reader = null
            }
            controller.error(err)
          }
        },
        async cancel(reason) {
          pending = null
          if (reader) {
            await reader.cancel(reason).catch(() => undefined)
            reader.releaseLock()
            reader = null
          }
        },
      })
    },
  }
}

export type RateInput = number | BandwidthLimiter | null | undefined

export function normalizeServerRate(input: RateInput): BandwidthLimiter | null {
  if (input === undefined || input === null || input === 0) return null
  if (typeof input === 'number') return createBandwidthLimiter(input)
  return input
}

/**
 * Разрешить настройку `rate` для конкретного вызова:
 * - `undefined` -> настройка сервера;
 * - `0` или `null` -> принудительно снять лимит скорости;
 * - `number > 0` или `BandwidthLimiter` -> переопределить на этот вызов.
 */
export function resolveCallRate(
  serverLimiter: BandwidthLimiter | null,
  callRate: RateInput,
): BandwidthLimiter | null {
  if (callRate === undefined) return serverLimiter
  if (callRate === null || callRate === 0) return null
  if (typeof callRate === 'number') return createBandwidthLimiter(callRate)
  return callRate
}
