// Серверная подготовка аватара из загруженного `File` в среде Node.
//
// Один и тот же конвейер `prepareAvatar` (`lib/image`) работает и на клиенте,
// и на сервере: браузер передаёт сжатый JPEG `File`, без JS браузер шлёт
// исходный файл (JPEG/PNG/WebP до `PHOTO_RAW_MAX_BYTES`), а сервер в обоих
// случаях декодирует по РЕАЛЬНОМУ формату заголовка (`probeImageHeader`),
// приводит к квадрату `edge×edge` и перекодирует в MozJPEG `≤ maxBytes`.
// Никакие внешние `base64`-строки по сети больше не принимаются.
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { getEncoder, type Frame } from '#lib/image/index.js'
import { probeImageHeader } from '#lib/image/probe.js'
import { prepareAvatar, type AvatarLimits, type AvatarOutcome } from './avatar.js'

const require = createRequire(import.meta.url)

async function wasmBytes(specifier: string): Promise<Uint8Array> {
  return readFile(require.resolve(specifier))
}

const wasmBuffer = async (specifier: string): Promise<ArrayBuffer> =>
  (await wasmBytes(specifier)).buffer as ArrayBuffer

let codecsReady: Promise<void> | undefined

/** Однократная инициализация WASM-кодеков `@jsquash/*` для процесса Node. */
export function ensureServerImageCodecs(): Promise<void> {
  codecsReady ??= (async () => {
    const jpegEnc = await import('@jsquash/jpeg/encode')
    await jpegEnc.init({ wasmBinary: await wasmBuffer('@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm') }).catch(() => undefined)
    const jpegDec = await import('@jsquash/jpeg/decode')
    await jpegDec.init({ wasmBinary: await wasmBuffer('@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm') }).catch(() => undefined)
    const pngDec = await import('@jsquash/png/decode')
    await pngDec.init(await wasmBytes('@jsquash/png/codec/pkg/squoosh_png_bg.wasm')).catch(() => undefined)
    const webpDec = await import('@jsquash/webp/decode')
    await webpDec.init({ wasmBinary: await wasmBuffer('@jsquash/webp/codec/dec/webp_dec.wasm') }).catch(() => undefined)
  })()
  return codecsReady
}

async function decodeOnServer(blob: Blob): Promise<Frame> {
  await ensureServerImageCodecs()
  const head = new Uint8Array(await blob.slice(0, 1_048_576).arrayBuffer())
  const facts = probeImageHeader(head)
  const format = facts?.format ?? blob.type
  const codec = getEncoder(format)
  if (!codec.decode) throw new Error(`no decode for ${format}`)
  return codec.decode(blob)
}

/** Привести входящий `File` на сервере к квадрату `edge×edge` JPEG `≤ maxBytes`. */
export async function prepareServerAvatar(
  file: File,
  limits: AvatarLimits,
): Promise<AvatarOutcome> {
  return prepareAvatar(file, limits, { decoder: decodeOnServer })
}
