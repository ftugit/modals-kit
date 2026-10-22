// Изоморфный аватарный конвейер `prepareAvatar` в Node: проверяет и кастомный
// декодер, и реальный серверный `decodeWithNode` из `#lib/image/node.js`
// (сырые JPEG/PNG с любым MIME → квадрат `edge×edge` JPEG `≤ maxBytes`).
import { beforeAll, describe, expect, it } from 'vitest'
import { getEncoder, type Frame } from '#lib/image/index.js'
import { probeImageHeader } from '#lib/image/probe.js'
import { decodeWithNode, ensureNodeImageCodecs } from '#lib/image/node.js'
import { prepareAvatar, type AvatarLimits } from './avatar.js'

beforeAll(ensureNodeImageCodecs)

const LIMITS: AvatarLimits = { edge: 200, maxBytes: 20_480, formats: ['jpeg'] }

function makeFrame(width: number, height: number, kind: 'photo' | 'noise'): Frame {
  const data = new Uint8ClampedArray(width * height * 4)
  let s = 42
  const rnd = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return s % 256
  }
  let i = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (kind === 'photo') {
        data[i++] = (x * 255) / width
        data[i++] = (y * 255) / height
        data[i++] = ((x + y) * 255) / (width + height)
      } else {
        data[i++] = rnd()
        data[i++] = rnd()
        data[i++] = rnd()
      }
      data[i++] = 255
    }
  }
  return { width, height, data }
}

async function imageFile(
  width: number,
  height: number,
  format: string,
  kind: 'photo' | 'noise' = 'photo',
): Promise<File> {
  const blob = await getEncoder(format).encode(makeFrame(width, height, kind), { quality: 0.9 })
  return new File([blob], `source.${format === 'image/png' ? 'png' : 'jpg'}`, { type: format })
}

function dataUrlBytes(dataUrl: string): Uint8Array {
  return Uint8Array.from(atob(dataUrl.slice(dataUrl.indexOf(',') + 1)), (c) => c.charCodeAt(0))
}

describe('prepareAvatar (#lib/image + decodeWithNode)', () => {
  it('фото → квадрат 200×200 JPEG в пределах веса', async () => {
    const outcome = await prepareAvatar(await imageFile(800, 600, 'image/jpeg'), LIMITS, {
      decoder: decodeWithNode,
    })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.dataUrl.startsWith('data:image/jpeg;base64,')).toBe(true)
    expect(outcome.bytes).toBeLessThanOrEqual(LIMITS.maxBytes)
    expect(outcome.quality).toBeGreaterThan(0.3)
    expect(probeImageHeader(dataUrlBytes(outcome.dataUrl))).toMatchObject({
      format: 'image/jpeg',
      width: 200,
      height: 200,
    })
  })

  it('конвертирует сырой PNG даже с чужим MIME (application/octet-stream) в 200×200 JPEG ≤ maxBytes', async () => {
    const pngBlob = await getEncoder('image/png').encode(makeFrame(320, 240, 'photo'))
    const rawUpload = new File([pngBlob], 'upload.bin', { type: 'application/octet-stream' })
    const outcome = await prepareAvatar(
      rawUpload,
      { ...LIMITS, formats: ['jpeg', 'png', 'webp'] },
      { decoder: decodeWithNode },
    )
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.file).toBeInstanceOf(File)
    expect(outcome.file.type).toBe('image/jpeg')
    expect(outcome.bytes).toBeLessThanOrEqual(LIMITS.maxBytes)
    expect(probeImageHeader(dataUrlBytes(outcome.dataUrl))).toMatchObject({
      format: 'image/jpeg',
      width: 200,
      height: 200,
    })
  })

  it('маленький исходник дотягивается до edge (апскейл)', async () => {
    const outcome = await prepareAvatar(await imageFile(60, 40, 'image/jpeg'), LIMITS, {
      decoder: decodeWithNode,
    })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(probeImageHeader(dataUrlBytes(outcome.dataUrl))).toMatchObject({ width: 200, height: 200 })
  })

  it('не картинка под видом .jpg — avatar-format по содержимому', async () => {
    const file = new File(['просто текст, не картинка'], 'evil.jpg', { type: 'image/jpeg' })
    const outcome = await prepareAvatar(file, LIMITS, { decoder: decodeWithNode })
    expect(outcome).toEqual({ ok: false, code: 'profile.avatar-format' })
  })

  it('PNG при разрешённом только jpeg — avatar-format; при разрешённом png — принимается', async () => {
    const png = await imageFile(300, 300, 'image/png')
    expect(await prepareAvatar(png, LIMITS, { decoder: decodeWithNode })).toEqual({
      ok: false,
      code: 'profile.avatar-format',
    })
    const relaxed = await prepareAvatar(png, { ...LIMITS, formats: ['jpeg', 'png'] }, {
      decoder: decodeWithNode,
    })
    expect(relaxed.ok).toBe(true)
  })

  it('шум не влезает в крошечный вес — avatar-size', async () => {
    const outcome = await prepareAvatar(
      await imageFile(400, 400, 'image/jpeg', 'noise'),
      { ...LIMITS, maxBytes: 300 },
      { decoder: decodeWithNode },
    )
    expect(outcome).toEqual({ ok: false, code: 'profile.avatar-size' })
  })
})
