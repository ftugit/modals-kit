// Потоковое аутентифицированное шифрование `AES-256-GCM` блоками по 64 КиБ (`STREAM`).
//
// Свойства формата:
// - 0 зависимостей от Node и фреймворков (чистый Web Crypto API `crypto.subtle`).
// - Фиксированный 32-байтный заголовок: 8 байт сигнатуры `MKSG1\0\0\0` + 24 байта случайной соли файла.
// - Из мастер-ключа (`Uint8Array` или парольной фразы `string`) и 24-байтной соли через `HKDF-SHA-256`
//   выводится уникальный 256-битный ключ именно для этого объекта.
// - Каждый блок до `65 536` байт открытого текста шифруется своим `12`-байтным nonce:
//   `[0, 0, 0, uint64be(chunkIndex), isFinal ? 1 : 0]`. Флаг `isFinal` в последнем блоке
//   криптографически защищает поток от усечения в конце, перестановки и дописывания чужих блоков.
// - Детерминированный размер шифротекста `encryptedSize(plainBytes)` и чтение произвольного
//   HTTP `Range` за $O(1)$ обращений без расшифровки всего файла целиком.

import { StreamFile } from './stream-file.js'
import type { LazyContent } from './types.js'

export const CRYPTO_CHUNK_PLAIN_BYTES = 65_536
export const CRYPTO_HEADER_BYTES = 32
export const CRYPTO_SALT_BYTES = 24
export const CRYPTO_TAG_BYTES = 16
export const CRYPTO_CHUNK_STORED_BYTES = CRYPTO_CHUNK_PLAIN_BYTES + CRYPTO_TAG_BYTES

const MAGIC_BYTES = new Uint8Array([0x4d, 0x4b, 0x53, 0x47, 0x31, 0x00, 0x00, 0x00]) // "MKSG1\0\0\0"
const HKDF_INFO = new TextEncoder().encode('modals-kit/storage/aes-256-gcm/v1')

export type StorageEncryptionKey = Uint8Array | string

export class StorageCryptoError extends Error {
  readonly code = 'STORAGE_CRYPTO_ERROR'
  constructor(message: string) {
    super(message)
    this.name = 'StorageCryptoError'
  }
}

function toArrayBufferUint8(src: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(src.byteLength))
  out.set(src)
  return out
}

function normalizeRawKeyBytes(key: StorageEncryptionKey): Uint8Array<ArrayBuffer> {
  if (typeof key === 'string') {
    if (key.length === 0) {
      throw new StorageCryptoError('[storage/crypto] ключ шифрования не может быть пустой строкой')
    }
    return toArrayBufferUint8(new TextEncoder().encode(key))
  }
  if (key instanceof Uint8Array) {
    if (key.byteLength < 16) {
      throw new StorageCryptoError(
        `[storage/crypto] бинарный ключ обязан содержать не менее 16 байт (получено ${key.byteLength})`,
      )
    }
    return toArrayBufferUint8(key)
  }
  throw new StorageCryptoError('[storage/crypto] некорректный тип ключа шифрования')
}

const HKDF_CACHE_LIMIT = 64
const hkdfStringKeyCache = new Map<string, Promise<CryptoKey>>()
const hkdfBytesKeyCache = new WeakMap<Uint8Array, Promise<CryptoKey>>()

function getHkdfBaseKey(masterKey: StorageEncryptionKey): Promise<CryptoKey> {
  if (typeof masterKey === 'string') {
    const hit = hkdfStringKeyCache.get(masterKey)
    if (hit) return hit
    const ikm = normalizeRawKeyBytes(masterKey)
    const created = crypto.subtle
      .importKey('raw', ikm, 'HKDF', false, ['deriveKey'])
      .catch((err) => {
        hkdfStringKeyCache.delete(masterKey)
        throw err
      })
    if (hkdfStringKeyCache.size >= HKDF_CACHE_LIMIT) {
      const oldest = hkdfStringKeyCache.keys().next().value
      if (oldest !== undefined) hkdfStringKeyCache.delete(oldest)
    }
    hkdfStringKeyCache.set(masterKey, created)
    return created
  }

  const hit = hkdfBytesKeyCache.get(masterKey)
  if (hit) return hit
  const ikm = normalizeRawKeyBytes(masterKey)
  const created = crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveKey'])
  hkdfBytesKeyCache.set(masterKey, created)
  return created
}

async function deriveObjectAesKey(
  masterKey: StorageEncryptionKey,
  salt: Uint8Array,
  usage: 'encrypt' | 'decrypt',
): Promise<CryptoKey> {
  const baseKey = await getHkdfBaseKey(masterKey)
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: toArrayBufferUint8(salt),
      info: toArrayBufferUint8(HKDF_INFO),
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    [usage],
  )
}

function makeChunkIv(chunkIndex: number, isFinal: boolean): Uint8Array<ArrayBuffer> {
  if (!Number.isSafeInteger(chunkIndex) || chunkIndex < 0) {
    throw new StorageCryptoError(`[storage/crypto] недопустимый индекс блока: ${chunkIndex}`)
  }
  const iv = new Uint8Array(new ArrayBuffer(12))
  const view = new DataView(iv.buffer)
  const hi = Math.floor(chunkIndex / 0x1_0000_0000)
  const lo = chunkIndex >>> 0
  view.setUint32(3, hi, false)
  view.setUint32(7, lo, false)
  iv[11] = isFinal ? 1 : 0
  return iv
}

function verifyHeaderAndExtractSalt(header: Uint8Array): Uint8Array {
  if (header.byteLength !== CRYPTO_HEADER_BYTES) {
    throw new StorageCryptoError(
      `[storage/crypto] повреждён заголовок зашифрованного объекта (${header.byteLength} байт)`,
    )
  }
  for (let i = 0; i < MAGIC_BYTES.byteLength; i++) {
    if (header[i] !== MAGIC_BYTES[i]) {
      throw new StorageCryptoError(
        '[storage/crypto] неверная сигнатура заголовка (объект не зашифрован форматом MKSG1)',
      )
    }
  }
  return header.subarray(MAGIC_BYTES.byteLength, CRYPTO_HEADER_BYTES)
}

/**
 * Точный размер зашифрованного потока по известному открытому размеру `plainBytes`.
 * Даже для пустого файла (`0` байт) записывается 32-байтный заголовок + 16-байтный финальный тег (`48` байт).
 */
export function encryptedSize(plainBytes: number): number {
  if (!Number.isSafeInteger(plainBytes) || plainBytes < 0) {
    throw new RangeError(`[storage/crypto] некорректный plainBytes: ${plainBytes}`)
  }
  if (plainBytes === 0) {
    return CRYPTO_HEADER_BYTES + CRYPTO_TAG_BYTES
  }
  const chunks = Math.ceil(plainBytes / CRYPTO_CHUNK_PLAIN_BYTES)
  return CRYPTO_HEADER_BYTES + plainBytes + chunks * CRYPTO_TAG_BYTES
}

/**
 * Точный открытый размер по физическому размеру зашифрованного объекта `storedBytes`.
 */
export function decryptedSize(storedBytes: number): number {
  const minBytes = CRYPTO_HEADER_BYTES + CRYPTO_TAG_BYTES
  if (!Number.isSafeInteger(storedBytes) || storedBytes < minBytes) {
    throw new StorageCryptoError(
      `[storage/crypto] слишком малый размер шифротекста: ${storedBytes}`,
    )
  }
  if (storedBytes === minBytes) return 0
  const body = storedBytes - CRYPTO_HEADER_BYTES
  const fullChunks = Math.floor(body / CRYPTO_CHUNK_STORED_BYTES)
  const rem = body % CRYPTO_CHUNK_STORED_BYTES
  if (rem > 0 && rem <= CRYPTO_TAG_BYTES) {
    throw new StorageCryptoError(
      `[storage/crypto] некорректный хвост последнего блока шифротекста (${rem} байт)`,
    )
  }
  const totalChunks = rem === 0 ? fullChunks : fullChunks + 1
  return body - totalChunks * CRYPTO_TAG_BYTES
}

/**
 * Потоково зашифровать `ReadableStream` без буферизации всего файла в памяти.
 * В памяти удерживается не более одного 64-КБ блока + 1 чанка предчтения для точного флага `isFinal`.
 */
export function encryptStream(
  source: ReadableStream<Uint8Array>,
  key: StorageEncryptionKey,
  signal?: AbortSignal,
): ReadableStream<Uint8Array<ArrayBuffer>> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  let aesKey: CryptoKey | null = null
  let chunkIndex = 0
  let finished = false
  const buf = new Uint8Array(CRYPTO_CHUNK_PLAIN_BYTES)
  let buffered = 0
  let pendingSlice: Uint8Array | null = null
  let sourceDone = false

  async function fillPlainChunk(): Promise<{ plain: Uint8Array<ArrayBuffer>; isFinal: boolean }> {
    while (buffered < CRYPTO_CHUNK_PLAIN_BYTES && !sourceDone) {
      if (pendingSlice && pendingSlice.byteLength > 0) {
        const take = Math.min(CRYPTO_CHUNK_PLAIN_BYTES - buffered, pendingSlice.byteLength)
        buf.set(pendingSlice.subarray(0, take), buffered)
        buffered += take
        pendingSlice =
          take < pendingSlice.byteLength ? pendingSlice.subarray(take) : null
        continue
      }
      const next = await reader!.read()
      if (next.done) {
        sourceDone = true
        break
      }
      if (next.value.byteLength > 0) {
        pendingSlice = next.value
      }
    }

    // Если набрали ровно 64 КиБ, нужно знать, закончился ли поток прямо на границе блока
    if (buffered === CRYPTO_CHUNK_PLAIN_BYTES && !sourceDone && (!pendingSlice || pendingSlice.byteLength === 0)) {
      while (!sourceDone) {
        const peek = await reader!.read()
        if (peek.done) {
          sourceDone = true
          break
        }
        if (peek.value.byteLength > 0) {
          pendingSlice = peek.value
          break
        }
      }
    }

    const isFinal = sourceDone && (!pendingSlice || pendingSlice.byteLength === 0)
    const plain = new Uint8Array(new ArrayBuffer(buffered))
    plain.set(buf.subarray(0, buffered))
    buffered = 0
    return { plain, isFinal }
  }

  return new ReadableStream<Uint8Array<ArrayBuffer>>({
    async pull(controller) {
      try {
        signal?.throwIfAborted()
        if (finished) {
          controller.close()
          return
        }

        if (!reader) {
          reader = source.getReader()
          const salt = crypto.getRandomValues(new Uint8Array(CRYPTO_SALT_BYTES))
          aesKey = await deriveObjectAesKey(key, salt, 'encrypt')
          const header = new Uint8Array(new ArrayBuffer(CRYPTO_HEADER_BYTES))
          header.set(MAGIC_BYTES, 0)
          header.set(salt, MAGIC_BYTES.byteLength)
          controller.enqueue(header)
          return
        }

        const { plain, isFinal } = await fillPlainChunk()
        const iv = makeChunkIv(chunkIndex, isFinal)
        chunkIndex += 1
        const cipherBuf = await crypto.subtle.encrypt(
          { name: 'AES-GCM', iv },
          aesKey!,
          plain,
        )
        controller.enqueue(new Uint8Array(cipherBuf))

        if (isFinal) {
          finished = true
          reader.releaseLock()
          reader = null
          controller.close()
        }
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
      finished = true
      if (reader) {
        await reader.cancel(reason).catch(() => undefined)
        reader.releaseLock()
        reader = null
      }
    },
  })
}

async function readExactRange(
  cipherFile: StreamFile,
  start: number,
  end: number,
): Promise<Uint8Array> {
  const expected = end - start
  const out = new Uint8Array(expected)
  let offset = 0
  const reader = cipherFile.slice(start, end).stream().getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (offset + value.byteLength > expected) {
        throw new StorageCryptoError('[storage/crypto] получено больше байт, чем запрошено в Range')
      }
      out.set(value, offset)
      offset += value.byteLength
    }
  } finally {
    reader.releaseLock()
  }
  if (offset !== expected) {
    throw new StorageCryptoError(
      `[storage/crypto] неполное чтение зашифрованного диапазона (${offset} из ${expected} байт)`,
    )
  }
  return out
}

/**
 * Обернуть зашифрованный `StreamFile` в прозрачный открытый `StreamFile` с поддержкой $O(1)$ `Range`:
 * при чтении `stream(start, end)` запрашиваются и расшифровываются ТОЛЬКО затронутые 64-КБ блоки.
 */
export function createDecryptedStreamFile(
  cipherFile: StreamFile,
  key: StorageEncryptionKey,
  options?: {
    plainSize?: number
    fileName?: string
    contentType?: string
    lastModified?: number
  },
): StreamFile {
  const storedBytes = cipherFile.size
  const inferredPlainSize = decryptedSize(storedBytes)
  if (
    options?.plainSize !== undefined &&
    storedBytes !== encryptedSize(options.plainSize)
  ) {
    throw new StorageCryptoError(
      `[storage/crypto] размер зашифрованного объекта (${storedBytes} Б) не совпадает с ожидаемым для ${options.plainSize} Б (${encryptedSize(options.plainSize)} Б)`,
    )
  }
  const plainSize = options?.plainSize ?? inferredPlainSize
  const totalChunks =
    plainSize === 0 ? 1 : Math.ceil(plainSize / CRYPTO_CHUNK_PLAIN_BYTES)

  let cachedAesKeyPromise: Promise<CryptoKey> | null = null

  function getAesKeyFromHeader(headerBytes?: Uint8Array): Promise<CryptoKey> {
    if (!cachedAesKeyPromise) {
      cachedAesKeyPromise = (async () => {
        const hdr =
          headerBytes ?? (await readExactRange(cipherFile, 0, CRYPTO_HEADER_BYTES))
        const salt = verifyHeaderAndExtractSalt(hdr)
        return deriveObjectAesKey(key, salt, 'decrypt')
      })()
    }
    return cachedAesKeyPromise
  }

  function encryptedChunkBounds(chunkIdx: number): { start: number; end: number } {
    const start = CRYPTO_HEADER_BYTES + chunkIdx * CRYPTO_CHUNK_STORED_BYTES
    if (plainSize === 0) {
      return { start: CRYPTO_HEADER_BYTES, end: CRYPTO_HEADER_BYTES + CRYPTO_TAG_BYTES }
    }
    const isLast = chunkIdx === totalChunks - 1
    const plainInChunk = isLast
      ? plainSize - chunkIdx * CRYPTO_CHUNK_PLAIN_BYTES
      : CRYPTO_CHUNK_PLAIN_BYTES
    return { start, end: start + plainInChunk + CRYPTO_TAG_BYTES }
  }

  const content: LazyContent = {
    byteLength: plainSize,
    stream(start = 0, end = plainSize): ReadableStream<Uint8Array<ArrayBuffer>> {
      const boundedStart = Math.max(0, Math.min(start, plainSize))
      const boundedEnd = Math.max(boundedStart, Math.min(end, plainSize))

      // Даже для пустого файла (0 байт) при чтении всего файла проверяем подлинность финального тега!
      if (plainSize === 0) {
        let verified = false
        return new ReadableStream<Uint8Array<ArrayBuffer>>({
          async pull(controller) {
            if (verified) {
              controller.close()
              return
            }
            verified = true
            try {
              const all = await readExactRange(
                cipherFile,
                0,
                CRYPTO_HEADER_BYTES + CRYPTO_TAG_BYTES,
              )
              const aesKey = await getAesKeyFromHeader(all.subarray(0, CRYPTO_HEADER_BYTES))
              const tagOnly = toArrayBufferUint8(all.subarray(CRYPTO_HEADER_BYTES))
              await crypto.subtle.decrypt(
                { name: 'AES-GCM', iv: makeChunkIv(0, true) },
                aesKey,
                tagOnly,
              )
              controller.close()
            } catch (err) {
              controller.error(
                err instanceof StorageCryptoError
                  ? err
                  : new StorageCryptoError('[storage/crypto] ошибка проверки подлинности AES-256-GCM'),
              )
            }
          },
        })
      }

      if (boundedStart >= boundedEnd) {
        return new ReadableStream<Uint8Array<ArrayBuffer>>({
          start(c) {
            c.close()
          },
        })
      }

      const firstChunk = Math.floor(boundedStart / CRYPTO_CHUNK_PLAIN_BYTES)
      const lastChunk = Math.floor((boundedEnd - 1) / CRYPTO_CHUNK_PLAIN_BYTES)
      let currentChunk = firstChunk
      let cipherReader: ReadableStreamDefaultReader<Uint8Array> | null = null
      let carry: Uint8Array = new Uint8Array(0)

      async function readNextBytesFromStream(need: number): Promise<Uint8Array<ArrayBuffer>> {
        const out = new Uint8Array(new ArrayBuffer(need))
        let filled = 0
        while (filled < need) {
          if (carry.byteLength > 0) {
            const take = Math.min(need - filled, carry.byteLength)
            out.set(carry.subarray(0, take), filled)
            filled += take
            carry = carry.subarray(take)
            continue
          }
          const { done, value } = await cipherReader!.read()
          if (done) {
            throw new StorageCryptoError(
              `[storage/crypto] неожиданный конец зашифрованного потока (${filled} из ${need} байт)`,
            )
          }
          carry = value
        }
        return out
      }

      return new ReadableStream<Uint8Array<ArrayBuffer>>({
        async pull(controller) {
          try {
            if (currentChunk > lastChunk) {
              if (cipherReader) {
                await cipherReader.cancel().catch(() => undefined)
                cipherReader.releaseLock()
                cipherReader = null
              }
              controller.close()
              return
            }

            if (!cipherReader) {
              const firstBounds = encryptedChunkBounds(firstChunk)
              const lastBounds = encryptedChunkBounds(lastChunk)
              if (firstChunk === 0 && !cachedAesKeyPromise) {
                // Оптимизация: читаем заголовок [0..32) и блоки [32..lastBounds.end) одним Range-запросом!
                cipherReader = cipherFile.slice(0, lastBounds.end).stream().getReader()
                const hdr = await readNextBytesFromStream(CRYPTO_HEADER_BYTES)
                await getAesKeyFromHeader(hdr)
              } else {
                await getAesKeyFromHeader()
                cipherReader = cipherFile.slice(firstBounds.start, lastBounds.end).stream().getReader()
              }
            }

            const aesKey = await getAesKeyFromHeader()
            const bounds = encryptedChunkBounds(currentChunk)
            const cipherChunk = await readNextBytesFromStream(bounds.end - bounds.start)
            const isFinal = currentChunk === totalChunks - 1

            let plainBuf: ArrayBuffer
            try {
              plainBuf = await crypto.subtle.decrypt(
                { name: 'AES-GCM', iv: makeChunkIv(currentChunk, isFinal) },
                aesKey,
                cipherChunk,
              )
            } catch {
              throw new StorageCryptoError(
                `[storage/crypto] нарушена целостность или неверный ключ в блоке #${currentChunk}`,
              )
            }

            const chunkPlain = new Uint8Array(plainBuf)
            const chunkGlobalStart = currentChunk * CRYPTO_CHUNK_PLAIN_BYTES
            const sliceFrom = currentChunk === firstChunk ? boundedStart - chunkGlobalStart : 0
            const sliceTo =
              currentChunk === lastChunk
                ? boundedEnd - chunkGlobalStart
                : chunkPlain.byteLength

            const outSlice = new Uint8Array(new ArrayBuffer(sliceTo - sliceFrom))
            outSlice.set(chunkPlain.subarray(sliceFrom, sliceTo))
            currentChunk += 1
            controller.enqueue(outSlice)

            if (currentChunk > lastChunk) {
              if (cipherReader) {
                await cipherReader.cancel().catch(() => undefined)
                cipherReader.releaseLock()
                cipherReader = null
              }
              controller.close()
            }
          } catch (err) {
            if (cipherReader) {
              await cipherReader.cancel(err).catch(() => undefined)
              cipherReader.releaseLock()
              cipherReader = null
            }
            controller.error(err)
          }
        },
        async cancel(reason) {
          if (cipherReader) {
            await cipherReader.cancel(reason).catch(() => undefined)
            cipherReader.releaseLock()
            cipherReader = null
          }
        },
      })
    },
  }

  return new StreamFile(content, options?.fileName ?? cipherFile.name, {
    type: options?.contentType ?? cipherFile.type,
    lastModified: options?.lastModified ?? cipherFile.lastModified,
  })
}
