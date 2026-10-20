// Аватарный конвейер на lib/image в Node: декодер — кодек реестра библиотеки
// (prepareAvatar принимает шлюз; в браузере декодирует createImageBitmap).
// Проверяются: валидация по СОДЕРЖИМОМУ, cover-квадрат edge×edge (вкл.
// апскейл маленького исходника), предикат веса и коды отказов.
import { beforeAll, describe, expect, it } from 'vitest'
import { getEncoder, type Frame } from '#lib/image/index.js'
import { probeImageHeader } from '#lib/image/probe.js'
import { ensureWasm } from '#lib/image/test-wasm.js'
import { prepareAvatar, type AvatarLimits } from './avatar.js'

beforeAll(ensureWasm)

const LIMITS: AvatarLimits = { edge: 200, maxBytes: 20_480, formats: ['jpeg'] }

/** Декодер-шлюз для Node: кодек реестра по MIME блоба. */
async function decoder(blob: Blob): Promise<Frame> {
  const codec = getEncoder(blob.type)
  if (!codec.decode) throw new Error(`no decode for ${blob.type}`)
  return codec.decode(blob)
}

/** Кадр: плавный градиент ('photo') или шум ('noise' — энкодеру тяжело). */
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

/** Реальный файл картинки заданного формата из синтетического кадра. */
async function imageFile(width: number, height: number, format: string, kind: 'photo' | 'noise' = 'photo'): Promise<File> {
  const blob = await getEncoder(format).encode(makeFrame(width, height, kind), { quality: 0.9 })
  return new File([blob], `source.${format === 'image/png' ? 'png' : 'jpg'}`, { type: format })
}

/** Байты готового dataURL для проверки probe. */
function dataUrlBytes(dataUrl: string): Uint8Array {
  return Uint8Array.from(atob(dataUrl.slice(dataUrl.indexOf(',') + 1)), (c) => c.charCodeAt(0))
}

describe('prepareAvatar (lib/image)', () => {
  it('фото → квадрат 200×200 JPEG в пределах веса', async () => {
    const outcome = await prepareAvatar(await imageFile(800, 600, 'image/jpeg'), LIMITS, { decoder })
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

  it('маленький исходник дотягивается до edge (апскейл, прежняя семантика)', async () => {
    const outcome = await prepareAvatar(await imageFile(60, 40, 'image/jpeg'), LIMITS, { decoder })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(probeImageHeader(dataUrlBytes(outcome.dataUrl))).toMatchObject({ width: 200, height: 200 })
  })

  it('не картинка — avatar-format по содержимому', async () => {
    const file = new File(['просто текст, не картинка'], 'evil.jpg', { type: 'image/jpeg' })
    const outcome = await prepareAvatar(file, LIMITS, { decoder })
    expect(outcome).toEqual({ ok: false, code: 'profile.avatar-format' })
  })

  it('PNG при разрешённом только jpeg — avatar-format; при разрешённом png — принимается', async () => {
    const png = await imageFile(300, 300, 'image/png')
    expect(await prepareAvatar(png, LIMITS, { decoder })).toEqual({ ok: false, code: 'profile.avatar-format' })
    const relaxed = await prepareAvatar(png, { ...LIMITS, formats: ['jpeg', 'png'] }, { decoder })
    expect(relaxed.ok).toBe(true)
  })

  it('шум не влезает в крошечный вес — avatar-size', async () => {
    const outcome = await prepareAvatar(
      await imageFile(400, 400, 'image/jpeg', 'noise'),
      { ...LIMITS, maxBytes: 300 },
      { decoder },
    )
    expect(outcome).toEqual({ ok: false, code: 'profile.avatar-size' })
  })
})
