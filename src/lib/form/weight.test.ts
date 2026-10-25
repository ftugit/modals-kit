import { describe, expect, test } from 'vitest'
import { defineForm, field, v } from './index.js'
import { MAX_BOUNDARY_BYTES, boundaryBytesOf, formWeight, multipartWeight } from './weight.js'

const MB = 1024 * 1024

/** Реальная сериализация той же среды — оракул для формулы. */
const actual = async (fd: FormData) => (await new Response(fd).arrayBuffer()).byteLength

const fdOf = (pairs: Array<[string, string | File]>) => {
  const fd = new FormData()
  for (const [k, val] of pairs) fd.append(k, val as string)
  return fd
}

describe('вес multipart-тела', () => {
  test('формула совпадает с реальной сериализацией: текст, кириллица, файл', async () => {
    const pairs: Array<[string, string | File]> = [
      ['note', 'a'],
      ['name', 'Вес'],
      ['doc', new File([new Uint8Array(10)], 'файл.pdf', { type: 'application/pdf' })],
    ]
    const fd = fdOf(pairs)
    const boundary = boundaryBytesOf(fd)!
    expect(boundary).toBeGreaterThanOrEqual(27)
    expect(multipartWeight(pairs, boundary).total).toBe(await actual(fd))
  })

  test('кириллица считается байтами, а не символами', () => {
    const a = multipartWeight([['n', 'aaaa']], 38)
    const b = multipartWeight([['n', 'Вес']], 38) // 6 байт против 4 символов
    expect(b.total - a.total).toBe(2)
    expect(b.text).toBe(6)
  })

  test('перевод строки нормализуется в CRLF — вес не занижается', () => {
    expect(multipartWeight([['n', 'a\nb']], 38).text).toBe(4)
  })

  test('кавычка в имени экранируется в %22 и считается по трём байтам', () => {
    const plain = multipartWeight([['n', 'a'], ['n2', '']], 38).total
    const quote = multipartWeight([['n', 'a'], ['n"2', '']], 38).total
    expect(quote).toBe(plain + 3) // `"` → `%22`: +2 байта к одному символу
  })

  test('перевод строки в имени тоже уходит в %0D%0A', () => {
    const plain = multipartWeight([['n', 'a']], 38).total
    const lf = multipartWeight([['n\nx', 'a']], 38).total
    expect(lf - plain).toBe(7) // `n` → `n%0D%0Ax`: 8 байт вместо 1
  })

  test('файл без типа уходит как application/octet-stream', async () => {
    const pairs: Array<[string, string | File]> = [['f', new File([new Uint8Array(3)], 'a.bin', { type: '' })]]
    const fd = fdOf(pairs)
    expect(multipartWeight(pairs, boundaryBytesOf(fd)!).total).toBe(await actual(fd))
  })

  test('по умолчанию граница — худший случай', () => {
    expect(multipartWeight([['n', 'a']]).boundary).toBe(MAX_BOUNDARY_BYTES)
  })
})

describe('вес формы из описания', () => {
  const d = defineForm({
    id: 'w',
    fields: {
      title: field.text({ label: 'Заголовок' }),
      photo: field.file({ label: 'Файл', validate: [v.maxSize(10 * MB)] }),
    },
  })

  test('совпадает с сериализацией значений той же формы', async () => {
    const values = { title: 'Привет', photo: new File([new Uint8Array(5)], 'a.jpg', { type: 'image/jpeg' }) }
    const fd = new FormData()
    for (const [k, v0] of Object.entries(values)) fd.append(k, v0 as string)
    const parts = formWeight(d, values, boundaryBytesOf(fd)!)
    expect(parts.total).toBe(await actual(fd))
    expect(parts.files + parts.text).toBe(5 + 12) // «Привет» — 12 байт UTF-8
  })

  test('пустая форма — только границы', () => {
    expect(formWeight(d, {}).files).toBe(0)
    expect(formWeight(d, {}).text).toBe(0)
    expect(formWeight(d, {}).overhead).toBeGreaterThan(0)
  })
})
