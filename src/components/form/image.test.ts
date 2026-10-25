import { describe, expect, it } from 'vitest'
import { AsyncRunner, CheckRegistry, check, defineForm, field, runAsyncChecks, v } from '#lib/form/index.js'
import { imageCheck, registerImageCheck } from './image'

/* Заголовки-фикстуры: проба смотрит структуру контейнера, декод не нужен. */

const u32 = (n: number) => [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0))

function pngHeader(width: number, height: number): Uint8Array {
  const b = new Uint8Array(29)
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  b.set([...u32(13), ...ascii('IHDR')], 8)
  b.set(u32(width), 16)
  b.set(u32(height), 20)
  b[24] = 8
  b[25] = 6
  return b
}

const asFile = (bytes: Uint8Array, name: string, type: string) =>
  new File([bytes as BlobPart], name, { type })

const ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4])

const runImageCheck = imageCheck()

describe('проверка изображений: обещание клиента и содержимое', () => {
  it('назвался картинкой — обязан ею быть: архив под .jpg отвергается', async () => {
    const out = (await runImageCheck(asFile(ZIP, 'photo.jpg', 'image/jpeg'), {} as never)) as unknown as {
      code: string; params: { name: string }
    }
    expect(out.code).toBe('image.format')
    expect(out.params.name).toBe('photo.jpg')
  })

  it('не картинка по обещанию — не наше дело (тип судит `accept`)', async () => {
    expect(await runImageCheck(asFile(new Uint8Array([1, 2, 3]), 'doc.pdf', 'application/pdf'), {} as never)).toBeNull()
    expect(await runImageCheck(null, {} as never)).toBeNull()
  })

  it('размеры сверх потолков — `image.dimensions`', async () => {
    const out = (await runImageCheck(asFile(pngHeader(20_000, 20_000), 'bomb.png', 'image/png'), {} as never)) as unknown as { code: string }
    expect(out.code).toBe('image.dimensions')
  })

  it('правило судит ОДИН файл: список разворачивает движок', async () => {
    const files = [asFile(pngHeader(80, 60), 'ok.png', 'image/png'), asFile(ZIP, 'bad-1.jpg', 'image/jpeg')]
    // массив правилу не значение: движок зовёт его по каждому файлу
    expect(await runImageCheck(files, {} as never)).toBeNull()
    const bad = (await runImageCheck(files[1], {} as never)) as unknown as { code: string; params: { name: string } }
    expect(bad.code).toBe('image.format')
    expect(bad.params.name).toBe('bad-1.jpg')
  })
})

describe('правило в форме: то же на клиенте и на сервере', () => {
  const d = defineForm({
    id: 'files',
    fields: {
      pics: field.file({
        multiple: true,
        validate: [v.accept(['image/*']), v.maxSize(1024 * 1024), check('image')],
      }),
    },
  })
  const registry = new CheckRegistry()
  registerImageCheck(registry)

  it('в реестре лежит `image`', () => {
    expect(registry.has('image')).toBe(true)
  })

  it('движок разворачивает список: строка на каждый плохой файл, обе стороны', async () => {
    const values = { pics: [asFile(ZIP, 'a.jpg', 'image/jpeg'), asFile(ZIP, 'b.png', 'image/png')] }
    const server = await runAsyncChecks(d, values, registry)
    const client = await new AsyncRunner(registry).run(d, 'pics', values)
    expect(server.map((e) => e.code)).toEqual(['image.format', 'image.format'])
    expect(client.map((e) => e.code)).toEqual(['image.format', 'image.format'])
    expect(server.map((e) => e.params?.['name'])).toEqual(['a.jpg', 'b.png'])
  })
})
