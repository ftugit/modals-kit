import { describe, expect, it } from 'vitest'
import { specAvatar, type SpecAvatar } from '../../spec-avatar.js'
import { fitsSpec } from './spec-fit.js'

/* Заголовок PNG: проба читает структуру контейнера, декод не нужен. */
const u32 = (n: number) => [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0))

function pngHeader(width: number, height: number): Uint8Array {
  const b = new Uint8Array(64)
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  b.set([...u32(13), ...ascii('IHDR')], 8)
  b.set(u32(width), 16)
  b.set(u32(height), 20)
  b[24] = 8
  b[25] = 6
  return b
}

const png = (w: number, h: number) => new File([pngHeader(w, h) as BlobPart], 'photo.png', { type: 'image/png' })

/** Спека под фикстуры: PNG 200×200, 1 КиБ — чтобы не собирать настоящий JPEG. */
const pngSpec: SpecAvatar = { width: 200, height: 200, maxBytes: 1024, format: 'png' }

describe('fitsSpec: конвертация не нужна?', () => {
  it('точное совпадение формата, кадра и веса — сохраняем как есть', async () => {
    expect(await fitsSpec(png(200, 200), pngSpec)).toBe(true)
  })

  it('другой кадр — приводить', async () => {
    expect(await fitsSpec(png(200, 100), pngSpec)).toBe(false)
    expect(await fitsSpec(png(1024, 1024), pngSpec)).toBe(false)
  })

  it('формат спеки не совпал с заявленным — приводить', async () => {
    expect(await fitsSpec(png(200, 200), specAvatar)).toBe(false)
  })

  it('назвался PNG, а внутри не он — приводить', async () => {
    const zip = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]) as BlobPart], 'x.png', { type: 'image/png' })
    expect(await fitsSpec(zip, pngSpec)).toBe(false)
  })

  it('тяжелее предела спеки — приводить', async () => {
    const big = new File([new Uint8Array(pngSpec.maxBytes + 1) as BlobPart], 'x.png', { type: 'image/png' })
    expect(await fitsSpec(big, pngSpec)).toBe(false)
  })
})
