// Серверный декодер изображений для среды Node (`options.decoder` в `#lib/image`).
//
// Браузерный `decodeWithBrowser` по контракту бросает `EnvironmentError` вне
// браузера (`createImageBitmap` + `OffscreenCanvas` отсутствуют). На сервере
// WASM-кодеки `@jsquash/{jpeg,png,webp}` пред-инициализируются байтами с диска
// один раз на процесс, а формат источника определяется по заголовку контейнера
// (`probeImageHeader`), а не по недоверенному `Content-Type` от клиента.
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { getEncoder, type Frame } from './index.js'
import { probeImageHeader } from './probe.js'

const require = createRequire(import.meta.url)

async function wasmBytes(specifier: string): Promise<Uint8Array> {
  return readFile(require.resolve(specifier))
}

const wasmBuffer = async (specifier: string): Promise<ArrayBuffer> =>
  (await wasmBytes(specifier)).buffer as ArrayBuffer

let codecsReady: Promise<void> | undefined

/** Однократная инициализация WASM-кодеков JPEG/PNG/WebP в процессе Node. */
export function ensureNodeImageCodecs(): Promise<void> {
  codecsReady ??= (async () => {
    const jpegEnc = await import('@jsquash/jpeg/encode')
    await jpegEnc.init({ wasmBinary: await wasmBuffer('@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm') }).catch(() => undefined)
    const jpegDec = await import('@jsquash/jpeg/decode')
    await jpegDec.init({ wasmBinary: await wasmBuffer('@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm') }).catch(() => undefined)
    const pngEnc = await import('@jsquash/png/encode')
    await pngEnc.init(await wasmBytes('@jsquash/png/codec/pkg/squoosh_png_bg.wasm')).catch(() => undefined)
    const pngDec = await import('@jsquash/png/decode')
    await pngDec.init(await wasmBytes('@jsquash/png/codec/pkg/squoosh_png_bg.wasm')).catch(() => undefined)
    const webpEnc = await import('@jsquash/webp/encode')
    await webpEnc.init({ wasmBinary: await wasmBuffer('@jsquash/webp/codec/enc/webp_enc_simd.wasm') }).catch(() => undefined)
    const webpDec = await import('@jsquash/webp/decode')
    await webpDec.init({ wasmBinary: await wasmBuffer('@jsquash/webp/codec/dec/webp_dec.wasm') }).catch(() => undefined)
  })()
  return codecsReady
}

/** Декодировать `Blob`/`File` в `Frame` в среде Node по реальному заголовку файла. */
export async function decodeWithNode(source: Blob): Promise<Frame> {
  await ensureNodeImageCodecs()
  const head = new Uint8Array(await source.slice(0, 1_048_576).arrayBuffer())
  const facts = probeImageHeader(head)
  const format = facts?.format ?? source.type
  const codec = getEncoder(format)
  if (!codec.decode) throw new Error(`Unsupported server image format: ${format}`)
  return codec.decode(source)
}
