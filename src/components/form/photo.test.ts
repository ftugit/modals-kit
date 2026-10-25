import { describe, expect, it } from 'vitest'
import {
  AsyncRunner, CheckRegistry, check, decode, defineForm, field, runAsyncChecks, v, validateForm,
  valuesForChecks,
} from '#lib/form/index.js'
import { checkPhotoFile, registerPhotoChecks, type PhotoSpec } from './photo'

/* Заголовки-фикстуры: probe смотрит структуру контейнера, декод не нужен. */

const u16 = (n: number) => [(n >> 8) & 0xff, n & 0xff]
const u32 = (n: number) => [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0))

function pngHeader(width: number, height: number): Uint8Array<ArrayBuffer> {
  const b = new Uint8Array(29)
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  b.set([...u32(13), ...ascii('IHDR')], 8)
  b.set(u32(width), 16)
  b.set(u32(height), 20)
  b[24] = 8 // глубина
  b[25] = 6 // цвет RGBA
  return b
}

function jpegHeader(width: number, height: number): Uint8Array<ArrayBuffer> {
  return new Uint8Array([
    0xff, 0xd8, // SOI
    0xff, 0xc0, 0x00, 0x11, 0x08, ...u16(height), ...u16(width), 0x03, // SOF0
    0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
    0xff, 0xd9, // EOI
  ])
}

function webpHeader(width: number, height: number): Uint8Array<ArrayBuffer> {
  const b = new Uint8Array(26) // VP8L, как синтетика в probe.test
  b.set(ascii('RIFF'), 0)
  b.set(ascii('WEBPVP8L'), 8)
  const bits = ((width - 1) | ((height - 1) << 14) | (1 << 28)) >>> 0
  b[20] = 0x2f
  b[21] = bits & 0xff
  b[22] = (bits >> 8) & 0xff
  b[23] = (bits >> 16) & 0xff
  b[24] = (bits >> 24) & 0xff
  return b
}

function avifHeader(width: number, height: number): Uint8Array<ArrayBuffer> {
  const box = (type: string, payload: number[]) => [...u32(8 + payload.length), ...ascii(type), ...payload]
  const ispe = box('ispe', [0, 0, 0, 0, ...u32(width), ...u32(height)])
  const meta = box('meta', [0, 0, 0, 0, ...box('iprp', box('ipco', ispe))])
  return new Uint8Array([...box('ftyp', [...ascii('avif'), 0, 0, 0, 0]), ...meta])
}

const SPEC: PhotoSpec = {
  id: 'test',
  input: { formats: ['image/jpeg', 'image/png', 'image/webp'], maxBytes: 8 * 1024 * 1024, maxPixels: 1_000_000, maxSide: 2000 },
  output: { format: 'image/jpeg', edge: 200, maxBytes: 20_480 },
}

const asFile = (bytes: Uint8Array<ArrayBuffer>, name: string, type: string) => new File([bytes], name, { type })

describe('содержимое фото (серверная проверка)', () => {
  it('содержимое: серверные форматы по заголовку проходят, имена не важны', async () => {
    expect(await checkPhotoFile(asFile(jpegHeader(64, 40), 'a.bin', ''), SPEC)).toBeNull()
    expect(await checkPhotoFile(asFile(pngHeader(64, 40), 'a.jpg', 'image/jpeg'), SPEC)).toBeNull()
    expect(await checkPhotoFile(asFile(webpHeader(300, 200), 'a.webp', 'image/webp'), SPEC)).toBeNull()
    expect(await checkPhotoFile(null, SPEC)).toBeNull() // пустое поле — дело required
  })

  it('содержимое: не-картинка и формат вне списка — image.format; бомба — image.dimensions', async () => {
    const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4])
    expect((await checkPhotoFile(asFile(zip, 'photo.jpg', 'image/jpeg'), SPEC))?.code).toBe('image.format')
    const avif = await checkPhotoFile(asFile(avifHeader(64, 40), 'a.avif', 'image/avif'), SPEC)
    expect(avif?.code).toBe('image.format')
    expect(avif?.params).toMatchObject({ format: 'image/avif' })
    const bomb = await checkPhotoFile(asFile(pngHeader(20000, 20000), 'bomb.png', 'image/png'), SPEC)
    expect(bomb?.code).toBe('image.dimensions')
    expect(bomb?.params).toMatchObject({ width: 20000, height: 20000 })
  })
})

describe('паритет проверки фото: AsyncRunner (клиент) и runAsyncChecks (сервер)', () => {
  const desc = defineForm({
    id: 'photo-parity',
    revision: 1,
    fields: {
      photo: field.file({
        label: 'Фото',
        // `cacheByValue: false` обязателен: `File` не ключуется по значению, и кэш
        // отвечал бы вердиктом предыдущего файла
        validate: [
          v.accept(SPEC.input.formats), v.maxSize(SPEC.input.maxBytes),
          check('photo:test', { cacheByValue: false }),
        ],
      }),
    },
  })
  const registry = new CheckRegistry()
  registerPhotoChecks(registry, [SPEC])

  const cases: readonly (readonly [string, File | null, string | null])[] = [
    ['валидный JPEG', asFile(jpegHeader(64, 40), 'a.jpg', 'image/jpeg'), null],
    ['архив под видом .jpg', asFile(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 9, 9]), 'a.jpg', 'image/jpeg'), 'image.format'],
    ['сырой AVIF', asFile(avifHeader(64, 40), 'a.avif', 'image/avif'), 'image.format'],
    ['заголовок-бомба', asFile(pngHeader(20000, 20000), 'a.png', 'image/png'), 'image.dimensions'],
    ['пустое поле', null, null],
  ]

  for (const [title, file, code] of cases) {
    it(`${title}: вердикт один на обеих сторонах`, async () => {
      const data = new FormData()
      if (file) data.set('photo', file)
      const values = valuesForChecks(data, desc)
      const server = await runAsyncChecks(desc, values, registry)
      const client = await new AsyncRunner(registry).run(desc, 'photo', values)
      expect(server.map((e) => e.code)).toEqual(code ? [code] : [])
      expect(client?.code ?? null).toBe(code)
    })
  }

  it('сырьё тяжелее input.maxBytes — синхронный maxSize на том же описании', () => {
    const big = new File([jpegHeader(8, 8), new Uint8Array(9 * 1024 * 1024)], 'big.jpg', { type: 'image/jpeg' })
    const data = new FormData()
    data.set('photo', big)
    const { values } = decode(data, desc)
    const codes = validateForm(desc, values, {}).map((e) => e.code)
    expect(codes).toContain('maxSize')
  })

  it('File не ключуется по значению: второй файл не получает вердикт первого', async () => {
    const runner = new AsyncRunner(registry)
    const valuesOf = (f: File) => {
      const data = new FormData()
      data.set('photo', f)
      return valuesForChecks(data, desc)
    }
    expect(await runner.run(desc, 'photo', valuesOf(asFile(jpegHeader(8, 8), 'ok.jpg', 'image/jpeg')))).toBeNull()
    const bad = await runner.run(desc, 'photo', valuesOf(asFile(avifHeader(8, 8), 'no.avif', 'image/avif')))
    expect(bad?.code).toBe('image.format')
  })
})
