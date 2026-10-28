import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { openLazyFile } from '@remix-run/fs'
import { normalizeStoragePath } from './index.js'
import { basenameOfStoragePath } from './memory.js'
import { StreamFile } from './stream-file.js'
import type { DriverPutInput, DriverStoredMeta, StorageDriver } from './types.js'

/** Настройки драйвера локальной файловой системы (`Node` / `Bun`). */
export interface LocalDriverOptions {
  /** Корневая папка хранения на диске. */
  readonly rootDir: string
  /** Базовый публичный URL раздачи (например `/api/files`). */
  readonly publicBaseUrl?: string
}

interface SidecarMeta {
  readonly contentType: string
  readonly lastModified: number
}

function safeTargetPath(absRoot: string, normalizedPath: string): string {
  const target = resolve(absRoot, ...normalizedPath.split('/'))
  const prefix = absRoot.endsWith(sep) ? absRoot : absRoot + sep
  if (!target.startsWith(prefix)) {
    throw new RangeError(`[storage/local] выход за пределы rootDir: «${normalizedPath}»`)
  }
  return target
}

async function readSidecar(metaPath: string): Promise<SidecarMeta | null> {
  try {
    const raw = await readFile(metaPath, 'utf8')
    const parsed = JSON.parse(raw) as Partial<SidecarMeta>
    if (typeof parsed.contentType === 'string' && typeof parsed.lastModified === 'number') {
      return { contentType: parsed.contentType, lastModified: parsed.lastModified }
    }
    return null
  } catch {
    return null
  }
}

/**
 * Потоковый драйвер локального диска:
 * - пишет входящий `ReadableStream` во временный `.storage-tmp/<uuid>.part` с обратным давлением (`drain`);
 * - при обрыве потока, `AbortSignal` или несовпадении `size` гарантированно удаляет `.part`;
 * - по завершении атомарно переименовывает `.part` в целевой путь;
 * - отдаёт диапазоны файла через `@remix-run/fs` (`openLazyFile`) внутри `StreamFile`.
 */
export function localDriver(options: LocalDriverOptions): StorageDriver {
  if (!options?.rootDir || typeof options.rootDir !== 'string') {
    throw new TypeError('[storage/local] localDriver: укажите rootDir')
  }
  const absRoot = resolve(options.rootDir)
  const tmpDir = join(absRoot, '.storage-tmp')
  const metaRoot = join(absRoot, '.storage-meta')

  return {
    kind: 'local',
    ...(options.publicBaseUrl !== undefined ? { publicBaseUrl: options.publicBaseUrl } : {}),

    async put(input: DriverPutInput): Promise<DriverStoredMeta> {
      const cleanPath = normalizeStoragePath(input.path)
      input.signal?.throwIfAborted()

      const finalPath = safeTargetPath(absRoot, cleanPath)
      const metaPath = safeTargetPath(metaRoot, `${cleanPath}.json`)
      await mkdir(tmpDir, { recursive: true })
      const partPath = join(tmpDir, `${randomUUID()}.part`)

      const handle = await open(partPath, 'wx')
      const out = handle.createWriteStream()
      let streamFailure: unknown
      out.on('error', (err) => {
        streamFailure = err
      })

      const reader = input.stream.getReader()
      let seen = 0
      let committed = false

      const onAbort = () => {
        void reader.cancel(input.signal?.reason).catch(() => undefined)
        out.destroy(
          input.signal?.reason instanceof Error
            ? input.signal.reason
            : new DOMException('Aborted', 'AbortError'),
        )
      }
      input.signal?.addEventListener('abort', onAbort, { once: true })

      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          if (streamFailure) throw streamFailure
          input.signal?.throwIfAborted()

          seen += value.byteLength
          if (input.size !== undefined && seen > input.size) {
            throw new RangeError(
              `[storage/local] поток превысил заявленный размер: ${seen} > ${input.size}`,
            )
          }
          if (!out.write(value)) {
            await once(out, 'drain')
            if (streamFailure) throw streamFailure
          }
        }

        input.signal?.throwIfAborted()
        if (input.size !== undefined && seen !== input.size) {
          throw new RangeError(
            `[storage/local] поток оборвался раньше заявленного размера: ${seen} !== ${input.size}`,
          )
        }

        await new Promise<void>((res, rej) => {
          out.end((err?: Error | null) => (err ? rej(err) : res()))
        })
        if (!out.closed) {
          await once(out, 'close')
        }
        if (streamFailure) throw streamFailure

        await mkdir(dirname(finalPath), { recursive: true })
        await mkdir(dirname(metaPath), { recursive: true })
        await rename(partPath, finalPath)
        committed = true

        const sidecar: SidecarMeta = {
          contentType: input.contentType,
          lastModified: input.lastModified,
        }
        await writeFile(metaPath, JSON.stringify(sidecar), 'utf8')

        return {
          path: cleanPath,
          size: seen,
          contentType: input.contentType,
          lastModified: input.lastModified,
        }
      } finally {
        input.signal?.removeEventListener('abort', onAbort)
        reader.releaseLock()
        if (!out.closed) {
          if (!out.destroyed) out.destroy()
          await once(out, 'close').catch(() => undefined)
        }
        if (!committed) {
          await unlink(partPath).catch(() => undefined)
        }
      }
    },

    async head(path: string): Promise<DriverStoredMeta | null> {
      const cleanPath = normalizeStoragePath(path)
      const finalPath = safeTargetPath(absRoot, cleanPath)
      const metaPath = safeTargetPath(metaRoot, `${cleanPath}.json`)
      try {
        const st = await stat(finalPath)
        if (!st.isFile()) return null
        const sidecar = await readSidecar(metaPath)
        const lazy = openLazyFile(finalPath, { name: basenameOfStoragePath(cleanPath) })
        return {
          path: cleanPath,
          size: st.size,
          contentType: sidecar?.contentType || lazy.type || 'application/octet-stream',
          lastModified: sidecar?.lastModified ?? Math.trunc(st.mtimeMs),
        }
      } catch {
        return null
      }
    },

    async lazy(path: string): Promise<StreamFile | null> {
      const cleanPath = normalizeStoragePath(path)
      const finalPath = safeTargetPath(absRoot, cleanPath)
      const meta = await this.head(cleanPath)
      if (!meta) return null

      const fileName = basenameOfStoragePath(cleanPath)
      return new StreamFile(
        {
          byteLength: meta.size,
          stream(start = 0, end = meta.size) {
            const diskFile = openLazyFile(finalPath, {
              name: fileName,
              type: meta.contentType,
              lastModified: meta.lastModified,
            })
            return diskFile.slice(start, end).stream()
          },
        },
        fileName,
        { type: meta.contentType, lastModified: meta.lastModified },
      )
    },

    async del(path: string): Promise<boolean> {
      const cleanPath = normalizeStoragePath(path)
      const finalPath = safeTargetPath(absRoot, cleanPath)
      const metaPath = safeTargetPath(metaRoot, `${cleanPath}.json`)
      let removed = false
      try {
        await unlink(finalPath)
        removed = true
      } catch {
        removed = false
      }
      await unlink(metaPath).catch(() => undefined)
      return removed
    },
  }
}
