// Smoke перенесённого ядра в окружении этого репозитория: конвейер image()
// работает на пользовательском кодеке и декодере-шлюзе (без wasm): реестр,
// frame-операции и fit с предикатом живые. Реальные кодеки — probe.test.ts.
import { describe, expect, it } from 'vitest'
import { createEncoderRegistry, image, EnvironmentError, type Codec, type Frame } from './index.js'

/** Кадр-градиент заданного размера. */
function gradient(width: number, height: number): Frame {
  const data = new Uint8ClampedArray(width * height * 4)
  let i = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      data[i++] = (x * 255) / width
      data[i++] = (y * 255) / height
      data[i++] = 128
      data[i++] = 255
    }
  }
  return { width, height, data }
}

/** Фейк-кодек: размер блоба растёт монотонно с качеством и числом пикселей. */
const fakeCodec: Codec = {
  capabilities: { quality: true, monotoneQualitySize: true },
  async encode(frameImage: Frame, options) {
    const quality = typeof options?.quality === 'number' ? options.quality : 0.8
    const size = Math.max(16, Math.round(frameImage.width * frameImage.height * (0.2 + 2 * quality) * 0.01))
    return new Blob([new Uint8Array(size)], { type: 'image/x-fake' })
  },
}

function options() {
  const registry = createEncoderRegistry()
  registry.register('image/x-fake', fakeCodec)
  return { registry, decoder: async () => gradient(400, 300) }
}

describe('lib/image: конвейер в окружении репозитория', () => {
  it('frame cover + fit по предикату веса', async () => {
    const hit = await image(
      new Blob(['x'], { type: 'image/x-fake' }),
      async (p) => {
        await p.frame({ width: 200, height: 200, fit: 'cover', method: 'bilinear' })
        return p.fit({ formats: ['image/x-fake'], quality: [0.3, 0.95] }, (c) => c.size <= 400)
      },
      options(),
    )
    expect(hit).not.toBeNull()
    expect(hit?.params.format).toBe('image/x-fake')
    expect(hit?.blob.size).toBeLessThanOrEqual(400)
    // cover дал 200×200: размер при quality q = 400×(0.2+2q) ≤ 400 → q ≤ 0.4
    expect(hit?.params.quality).toBeLessThanOrEqual(0.41)
    expect(hit?.params.quality).toBeGreaterThan(0.3)
  })

  it('fit возвращает null на недостижимом предикате', async () => {
    const hit = await image(
      new Blob(['x'], { type: 'image/x-fake' }),
      (p) => p.fit({ formats: ['image/x-fake'], quality: [0.5, 0.9] }, (c) => c.size <= 10),
      options(),
    )
    expect(hit).toBeNull()
  })

  it('вне браузера без своего декодера — честный отказ', async () => {
    await expect(
      image(new Blob(['x'], { type: 'image/jpeg' }), (p) => p.encode('image/jpeg')),
    ).rejects.toBeInstanceOf(EnvironmentError)
  })
})
