// Изоморфная потоковая цепочка целостности с одноразовой солью (`HMAC-SHA-256` поверх `SHA-256`).
//
// Ресурсный профиль («халявная соль» на отдельную загрузку):
// - `0` внешних зависимостей: работает через аппаратный Web Crypto (`crypto.subtle`)
//   в браузере, Node 22+, Vercel Functions и Cloudflare Workers;
// - `O(1)` памяти: хранится только текущее состояние цепочки (`32` байта на файл);
// - `0` лишних чтений диска и `0` копирований сегмента `256 КБ`: `SHA-256(chunk)`
//   читает уже вырезанный буфер сегмента на месте, а `HMAC` подписывает компактный
//   80-байтный дескриптор шага (`prevTag || segmentIndex || offset || length || chunkSha`).

/** Длина тега `HMAC-SHA-256` и одноразовой соли сессии в байтах. */
export const WS_HMAC_TAG_BYTES = 32

function toHex(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    out += bytes[i]!.toString(16).padStart(2, '0')
  }
  return out
}

function fromHex(hex: string): Uint8Array<ArrayBuffer> | null {
  if (hex.length !== WS_HMAC_TAG_BYTES * 2 || hex.length % 2 !== 0) return null
  const out = new Uint8Array(new ArrayBuffer(hex.length / 2))
  for (let i = 0; i < out.byteLength; i++) {
    const byte = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
    if (Number.isNaN(byte)) return null
    out[i] = byte
  }
  return out
}

function asArrayBufferView(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  if (bytes.buffer instanceof ArrayBuffer) {
    return bytes as Uint8Array<ArrayBuffer>
  }
  const copy = new Uint8Array(new ArrayBuffer(bytes.byteLength))
  copy.set(bytes)
  return copy
}

/** Сгенерировать криптостойкую одноразовую соль (`64` hex-символа = `32` байта) на одну загрузку. */
export function generateUploadSaltHex(): string {
  const bytes = new Uint8Array(WS_HMAC_TAG_BYTES)
  globalThis.crypto.getRandomValues(bytes)
  return toHex(bytes)
}

/** Сравнение двух 32-байтных тегов за константное время без зависимости от `node:crypto`. */
export function timingSafeTagEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== WS_HMAC_TAG_BYTES || b.byteLength !== WS_HMAC_TAG_BYTES) return false
  let diff = 0
  for (let i = 0; i < WS_HMAC_TAG_BYTES; i++) {
    diff |= a[i]! ^ b[i]!
  }
  return diff === 0
}

/** Импортировать hex-соль загрузки в нативный `CryptoKey` для `HMAC-SHA-256`. */
export async function importUploadSaltKey(saltHex: string): Promise<CryptoKey | null> {
  const raw = fromHex(saltHex)
  if (!raw) return null
  return globalThis.crypto.subtle.importKey(
    'raw',
    raw,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
}

export interface FileIntegrityChain {
  /** Вычислить следующий 32-байтный тег цепочки и продвинуть внутреннее состояние. */
  nextSegmentTag(
    segmentIndex: number,
    offset: number,
    chunk: Uint8Array,
  ): Promise<Uint8Array<ArrayBuffer>>
}

/**
 * Создать потоковую цепочку `HMAC-SHA-256` для одного файла внутри загрузки.
 * Корень цепочки связывает `fileId` и точный заявленный `totalSize`.
 */
export async function createFileIntegrityChain(
  key: CryptoKey,
  fileId: string,
  totalSize: number,
): Promise<FileIntegrityChain> {
  const seedBytes = new TextEncoder().encode(`ws-upload-v1|${fileId}|${totalSize}`)
  let stateTag = new Uint8Array(await globalThis.crypto.subtle.sign('HMAC', key, seedBytes))

  // Переиспользуемый 80-байтный буфер шага:
  // [0..32) prevTag | [32..36) segIdx u32 | [36..44) offset u64 | [44..48) len u32 | [48..80) sha256(chunk)
  const stepBuf = new ArrayBuffer(80)
  const stepBytes = new Uint8Array(stepBuf)
  const stepView = new DataView(stepBuf)

  return {
    async nextSegmentTag(
      segmentIndex: number,
      offset: number,
      chunk: Uint8Array,
    ): Promise<Uint8Array<ArrayBuffer>> {
      const chunkSha = new Uint8Array(
        await globalThis.crypto.subtle.digest('SHA-256', asArrayBufferView(chunk)),
      )
      stepBytes.set(stateTag, 0)
      stepView.setUint32(32, segmentIndex >>> 0, false)
      stepView.setBigUint64(36, BigInt(offset), false)
      stepView.setUint32(44, chunk.byteLength >>> 0, false)
      stepBytes.set(chunkSha, 48)

      const next = new Uint8Array(await globalThis.crypto.subtle.sign('HMAC', key, stepBytes))
      stateTag = next
      return next
    },
  }
}
