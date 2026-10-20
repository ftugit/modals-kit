// Тестовый шов для реальных wasm-кодеков в Node (vitest окружение этого
// репозитория — node). @jsquash/* по умолчанию грузят .wasm через fetch(file://)
// — Node так не умеет, поэтому кодеки пред-инициализируются байтами с диска.
// Энкод при этом настоящий; библиотека об этом файле не знает.
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

async function wasmBytes(specifier: string): Promise<Uint8Array> {
  return readFile(require.resolve(specifier))
}
const wasmBuffer = async (specifier: string): Promise<ArrayBuffer> =>
  (await wasmBytes(specifier)).buffer as ArrayBuffer

let ready: Promise<void> | undefined

/** Инициализировать wasm-кодеки JPEG/PNG/WebP (идемпотентно, один промисс процесс). */
export function ensureWasm(): Promise<void> {
  ready ??= (async () => {
    const jpegEnc = await import('@jsquash/jpeg/encode')
    await jpegEnc.init({ wasmBinary: await wasmBuffer('@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm') }).catch(() => undefined)
    const jpegDec = await import('@jsquash/jpeg/decode')
    await jpegDec.init({ wasmBinary: await wasmBuffer('@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm') }).catch(() => undefined)
    const pngEnc = await import('@jsquash/png/encode')
    await pngEnc.init(await wasmBytes('@jsquash/png/codec/pkg/squoosh_png_bg.wasm'))
    const pngDec = await import('@jsquash/png/decode')
    await pngDec.init(await wasmBytes('@jsquash/png/codec/pkg/squoosh_png_bg.wasm'))
    const webpEnc = await import('@jsquash/webp/encode')
    await webpEnc.init({ wasmBinary: await wasmBuffer('@jsquash/webp/codec/enc/webp_enc_simd.wasm') }).catch(() => undefined)
    const webpDec = await import('@jsquash/webp/decode')
    await webpDec.init({ wasmBinary: await wasmBuffer('@jsquash/webp/codec/dec/webp_dec.wasm') }).catch(() => undefined)
  })()
  return ready
}
