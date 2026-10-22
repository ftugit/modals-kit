import { describe, expect, it } from 'vitest'
import { getEncoder, type Frame } from '#lib/image/index.js'
import { probeImageHeader } from '#lib/image/probe.js'
import { ensureServerImageCodecs, prepareServerAvatar } from './server-avatar.js'

const LIMITS = { edge: 200, maxBytes: 20_480, formats: ['jpeg', 'png', 'webp'] as const }

function gradientFrame(width: number, height: number): Frame {
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

describe('prepareServerAvatar (Node WASM pipeline)', () => {
  it('конвертирует сырой PNG даже с пустым/чужим MIME в квадрат 200×200 JPEG ≤ maxBytes', async () => {
    await ensureServerImageCodecs()
    const pngBlob = await getEncoder('image/png').encode(gradientFrame(320, 240))
    const rawFile = new File([pngBlob], 'upload.bin', { type: 'application/octet-stream' })

    const out = await prepareServerAvatar(rawFile, LIMITS)
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.file).toBeInstanceOf(File)
    expect(out.file.type).toBe('image/jpeg')
    expect(out.bytes).toBeLessThanOrEqual(LIMITS.maxBytes)

    const bytes = new Uint8Array(await out.file.arrayBuffer())
    expect(probeImageHeader(bytes)).toMatchObject({
      format: 'image/jpeg',
      width: 200,
      height: 200,
    })
  })

  it('отклоняет не-картинку под видом JPEG', async () => {
    const fake = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4])], 'evil.jpg', {
      type: 'image/jpeg',
    })
    const out = await prepareServerAvatar(fake, LIMITS)
    expect(out).toEqual({ ok: false, code: 'profile.avatar-format' })
  })
})
