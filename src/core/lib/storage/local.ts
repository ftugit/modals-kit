import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { openLazyFile } from '@remix-run/fs'
import { normalizeStoragePath } from './index.js'
import {
  computeLedgerUsage,
  defineStorageLedger,
  filterUnreferencedPartsInState,
  findByHashInState,
  listMissingFilesInState,
  sweepExpiredInState,
  type AdaptedStorageLedger,
  type LedgerReservation,
  type LedgerStateData,
} from './ledger.js'
import { basenameOfStoragePath } from './memory.js'
import { StreamFile } from './stream-file.js'
import type {
  DriverPutInput,
  DriverStoredMeta,
  StagedSpoolFile,
  StorageDriver,
  StorageSpool,
} from './types.js'

/** Настройки реестра учёта в локальном JSON-файле. */
export interface JsonLedgerOptions {
  /** Абсолютный или относительный путь к JSON-файлу учёта. */
  readonly filePath: string
}

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

function isFsNotFound(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code
  return code === 'ENOENT' || code === 'ENOTDIR'
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
  } catch (err) {
    if (isFsNotFound(err) || err instanceof SyntaxError) return null
    throw err
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
      } catch (err) {
        if (isFsNotFound(err)) return null
        throw err
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
      } catch (err) {
        if (!isFsNotFound(err)) throw err
        removed = false
      }
      await unlink(metaPath).catch((err) => {
        if (!isFsNotFound(err)) throw err
      })
      return removed
    },
  }
}

/**
 * Надёжный реестр учёта `ledger` в JSON-файле на диске с внутрипроцессным мьютексом
 * и атомарной перезаписью `<file>.tmp-<uuid>` -> `rename` (без частичной записи при сбое).
 */
export function jsonLedger(
  options: JsonLedgerOptions,
  nowFn: () => number = Date.now,
): AdaptedStorageLedger {
  if (!options?.filePath || typeof options.filePath !== 'string') {
    throw new TypeError('[storage/local] jsonLedger: укажите filePath')
  }
  const absFile = resolve(options.filePath)
  const dir = dirname(absFile)
  let tail: Promise<unknown> = Promise.resolve()

  function withLock<T>(fn: () => Promise<T>): Promise<T> {
    const next = tail.then(fn, fn)
    tail = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }

  async function loadState(): Promise<LedgerStateData> {
    try {
      const raw = await readFile(absFile, 'utf8')
      const parsed = JSON.parse(raw) as Partial<LedgerStateData>
      return {
        files: parsed.files && typeof parsed.files === 'object' ? { ...parsed.files } : {},
        reservations:
          parsed.reservations && typeof parsed.reservations === 'object'
            ? { ...parsed.reservations }
            : {},
      }
    } catch (err) {
      if ((err as { code?: unknown } | null)?.code === 'ENOENT') {
        return { files: {}, reservations: {} }
      }
      throw err
    }
  }

  async function saveState(state: LedgerStateData): Promise<void> {
    await mkdir(dir, { recursive: true })
    const tmpFile = `${absFile}.tmp-${randomUUID()}`
    await writeFile(tmpFile, JSON.stringify(state, null, 2), 'utf8')
    await rename(tmpFile, absFile)
  }

  return defineStorageLedger({
    reserve({ id, allocations, ttlMs }) {
      return withLock(async () => {
        const now = nowFn()
        const state = await loadState()
        const swept = sweepExpiredInState(state, now)
        if (state.reservations[id]) {
          if (swept > 0) await saveState(state)
          return state.reservations[id]!
        }

        const snap = computeLedgerUsage(
          state,
          allocations.map((a) => a.server),
          now,
        )
        for (const alloc of allocations) {
          const cur = snap[alloc.server] ?? {
            usedBytes: 0,
            reservedBytes: 0,
            filesCount: 0,
            partsCount: 0,
          }
          if (cur.usedBytes + cur.reservedBytes + alloc.bytes > alloc.maxStorageBytes) {
            if (swept > 0) await saveState(state)
            return null
          }
        }

        const created: LedgerReservation = {
          id,
          allocations: [...allocations],
          expiresAt: now + Math.max(1, ttlMs),
        }
        state.reservations[id] = created
        await saveState(state)
        return created
      })
    },

    commit({ reservationId, file }) {
      return withLock(async () => {
        const state = await loadState()
        delete state.reservations[reservationId]
        const replaced = state.files[file.path]
        state.files[file.path] = file
        await saveState(state)
        return replaced ? { replaced } : {}
      })
    },

    release(reservationId) {
      return withLock(async () => {
        const state = await loadState()
        if (state.reservations[reservationId]) {
          delete state.reservations[reservationId]
          await saveState(state)
        }
      })
    },

    sweepExpired(now = nowFn()) {
      return withLock(async () => {
        const state = await loadState()
        const removed = sweepExpiredInState(state, now)
        if (removed > 0) await saveState(state)
        return removed
      })
    },

    getFile(path) {
      return withLock(async () => {
        const state = await loadState()
        return state.files[path] ?? null
      })
    },

    deleteFile(path) {
      return withLock(async () => {
        const state = await loadState()
        const prev = state.files[path] ?? null
        if (prev) {
          delete state.files[path]
          await saveState(state)
        }
        return prev
      })
    },

    listFiles(opts) {
      return withLock(async () => {
        const state = await loadState()
        const prefix = opts?.prefix ?? ''
        const sorted = Object.keys(state.files)
          .filter((k) => !k.startsWith('@replica:') && k.startsWith(prefix))
          .sort()
        const startIdx = opts?.cursor ? Math.max(0, sorted.indexOf(opts.cursor) + 1) : 0
        const limit = opts?.limit ?? sorted.length
        const sliceKeys = sorted.slice(startIdx, startIdx + limit)
        const entries = sliceKeys.map((k) => state.files[k]!)
        const nextCursor =
          startIdx + limit < sorted.length ? sliceKeys[sliceKeys.length - 1] : undefined
        return { entries, ...(nextCursor ? { cursor: nextCursor } : {}) }
      })
    },

    usage(servers) {
      return withLock(async () => {
        const now = nowFn()
        const state = await loadState()
        const swept = sweepExpiredInState(state, now)
        if (swept > 0) await saveState(state)
        return computeLedgerUsage(state, servers, now)
      })
    },

    findByHash(hash, size) {
      return withLock(async () => {
        const state = await loadState()
        return findByHashInState(state, hash, size)
      })
    },

    filterUnreferencedParts(parts, excludePath) {
      return withLock(async () => {
        const state = await loadState()
        return filterUnreferencedPartsInState(state, parts, excludePath)
      })
    },

    patchFile(path, updater) {
      return withLock(async () => {
        const state = await loadState()
        const cur = state.files[path]
        if (!cur) return null
        const next = updater(cur)
        if (!next) return null
        state.files[path] = next
        await saveState(state)
        return next
      })
    },

    listMissingFiles(opts) {
      return withLock(async () => {
        const state = await loadState()
        return listMissingFilesInState(state, opts)
      })
    },
  })
}

/**
 * Дисковый спул временных файлов для `stageToDisk: true`:
 * потоково сохраняет входящий `ReadableStream` на диск с обратным давлением (`drain`),
 * возвращает точный `size` и sliceable `StreamFile` (пригодный для нарезки `split` и догрузки),
 * а `cleanup()` удаляет временный файл по окончании операции.
 */
export function localSpool(spoolDir: string): StorageSpool {
  if (!spoolDir || typeof spoolDir !== 'string') {
    throw new TypeError('[storage/local] localSpool: укажите spoolDir')
  }
  const absDir = resolve(spoolDir)

  return {
    async stage(
      stream: ReadableStream<Uint8Array>,
      signal?: AbortSignal,
    ): Promise<StagedSpoolFile> {
      signal?.throwIfAborted()
      await mkdir(absDir, { recursive: true })
      const tempPath = join(absDir, `${randomUUID()}.spool`)

      const handle = await open(tempPath, 'wx')
      const out = handle.createWriteStream()
      let streamFailure: unknown
      out.on('error', (err) => {
        streamFailure = err
      })

      const reader = stream.getReader()
      let seen = 0
      let finished = false

      const onAbort = () => {
        void reader.cancel(signal?.reason).catch(() => undefined)
        out.destroy(
          signal?.reason instanceof Error
            ? signal.reason
            : new DOMException('Aborted', 'AbortError'),
        )
      }
      signal?.addEventListener('abort', onAbort, { once: true })

      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          if (streamFailure) throw streamFailure
          signal?.throwIfAborted()
          seen += value.byteLength
          if (!out.write(value)) {
            await once(out, 'drain')
          }
        }
        await new Promise<void>((res, rej) => {
          out.end((err?: Error | null) => (err ? rej(err) : res()))
        })
        if (!out.closed) {
          await once(out, 'close')
        }
        if (streamFailure) throw streamFailure
        finished = true
      } finally {
        signal?.removeEventListener('abort', onAbort)
        reader.releaseLock()
        if (!out.closed) {
          if (!out.destroyed) out.destroy()
          await once(out, 'close').catch(() => undefined)
        }
        if (!finished) {
          await unlink(tempPath).catch(() => undefined)
        }
      }

      const lazy = openLazyFile(tempPath)
      const file = new StreamFile(
        {
          byteLength: seen,
          stream(start = 0, end = seen) {
            return lazy.slice(start, end).stream() as ReadableStream<Uint8Array<ArrayBuffer>>
          },
        },
        'staged.spool',
      )

      return {
        size: seen,
        file,
        async cleanup() {
          await unlink(tempPath).catch(() => undefined)
        },
      }
    },
  }
}

