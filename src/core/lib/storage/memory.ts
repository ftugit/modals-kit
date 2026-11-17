import { StreamFile } from './stream-file.js'
import type { DriverPutInput, DriverStoredMeta, StorageDriver } from './types.js'

interface MemoryRecord extends DriverStoredMeta {
  readonly bytes: Uint8Array<ArrayBuffer>
}

/** Настройки драйвера хранения в памяти процесса (для тестов и локальных стендов). */
export interface MemoryDriverOptions {
  readonly publicBaseUrl?: string
}

/** Имя файла из нормализованного относительного пути. */
export function basenameOfStoragePath(path: string): string {
  const idx = path.lastIndexOf('/')
  return idx >= 0 ? path.slice(idx + 1) : path
}

/**
 * Потоковый драйвер в памяти: читает входной `ReadableStream` с проверкой
 * `signal` и заявленного `size`, отдаёт `StreamFile` с поддержкой `Range`-срезов.
 */
export function memoryDriver(options: MemoryDriverOptions = {}): StorageDriver {
  const records = new Map<string, MemoryRecord>()

  return {
    kind: 'memory',
    ...(options.publicBaseUrl !== undefined ? { publicBaseUrl: options.publicBaseUrl } : {}),

    async put(input: DriverPutInput): Promise<DriverStoredMeta> {
      input.signal?.throwIfAborted()
      const chunks: Uint8Array[] = []
      let seen = 0
      const reader = input.stream.getReader()
      const onAbort = () => {
        void reader.cancel(input.signal?.reason).catch(() => undefined)
      }
      input.signal?.addEventListener('abort', onAbort, { once: true })
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          input.signal?.throwIfAborted()
          seen += value.byteLength
          if (input.size !== undefined && seen > input.size) {
            throw new RangeError(
              `[storage/memory] поток превысил заявленный размер: ${seen} > ${input.size}`,
            )
          }
          chunks.push(value)
        }
        input.signal?.throwIfAborted()
        if (input.size !== undefined && seen !== input.size) {
          throw new RangeError(
            `[storage/memory] поток оборвался раньше заявленного размера: ${seen} !== ${input.size}`,
          )
        }
      } finally {
        input.signal?.removeEventListener('abort', onAbort)
        reader.releaseLock()
      }

      const bytes = new Uint8Array(new ArrayBuffer(seen))
      let offset = 0
      for (const chunk of chunks) {
        bytes.set(chunk, offset)
        offset += chunk.byteLength
      }
      const meta: DriverStoredMeta = {
        path: input.path,
        size: seen,
        contentType: input.contentType,
        lastModified: input.lastModified,
      }
      records.set(input.path, { ...meta, bytes })
      return meta
    },

    async head(path: string): Promise<DriverStoredMeta | null> {
      const hit = records.get(path)
      if (!hit) return null
      return {
        path: hit.path,
        size: hit.size,
        contentType: hit.contentType,
        lastModified: hit.lastModified,
      }
    },

    async lazy(path: string): Promise<StreamFile | null> {
      const hit = records.get(path)
      if (!hit) return null
      return new StreamFile(
        {
          byteLength: hit.size,
          stream(start = 0, end = hit.size) {
            const slice = hit.bytes.subarray(start, end)
            return new ReadableStream<Uint8Array<ArrayBuffer>>({
              start(controller) {
                if (slice.byteLength > 0) {
                  const copy = new Uint8Array(new ArrayBuffer(slice.byteLength))
                  copy.set(slice)
                  controller.enqueue(copy)
                }
                controller.close()
              },
            })
          },
        },
        basenameOfStoragePath(path),
        { type: hit.contentType, lastModified: hit.lastModified },
      )
    },

    async del(path: string): Promise<boolean> {
      return records.delete(path)
    },
  }
}
