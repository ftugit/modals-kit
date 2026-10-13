// Ядро писателя адреса (F41) без фреймворка: среда — подставная.
import { describe, expect, it } from 'vitest'
import { createAddressWriter, type AddressCommit, type AddressSnapshot } from './address'

function env(start = 'http://app.test/films') {
  let real: AddressSnapshot = { url: new URL(start), state: {} }
  const sent: Array<AddressCommit & { done: () => void; fail: (e: unknown) => void }> = []
  const writer = createAddressWriter({
    read: () => real,
    commit: (step) =>
      new Promise((resolve, reject) => {
        sent.push({
          ...step,
          done: () => {
            real = { url: new URL(step.href, real.url), state: step.state }
            resolve(undefined)
          },
          fail: reject,
        })
      }),
  })
  return {
    writer,
    sent,
    setReal: (href: string, state: Record<string, unknown> = {}) =>
      (real = { url: new URL(href, real.url), state }),
  }
}
const tick = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

describe('createAddressWriter', () => {
  it('замена уточняет ещё не отправленную запись, шаг истории тот же', async () => {
    const { writer, sent } = env()
    void writer.write(() => ({ url: '/films?modal=a' }), { replace: false })
    void writer.write(() => ({ url: '/films?modal=b' }), { replace: false })
    void writer.write((c) => ({ url: `${c.url.pathname}${c.url.search}&page=2` }), { replace: true })
    expect(sent).toHaveLength(1)
    sent[0]!.done()
    await tick()
    expect(sent).toHaveLength(2)
    expect(sent[1]).toMatchObject({ href: '/films?modal=b&page=2', replace: false })
  })

  it('замена на то же самое — без коммита', async () => {
    const { writer, sent } = env('http://app.test/films?page=2')
    await writer.write((c) => ({ url: c.url }), { replace: true })
    expect(sent).toHaveLength(0)
  })

  it('отказ отклоняет промис записи, следующие шаги идут дальше', async () => {
    const { writer, sent } = env()
    const first = writer.write(() => ({ url: '/films?modal=a' }), { replace: false })
    const second = writer.write(() => ({ url: '/films?modal=b' }), { replace: false })
    sent[0]!.fail(new Error('nope'))
    await expect(first).rejects.toThrow('nope')
    await tick()
    sent[1]!.done()
    await expect(second).resolves.toBeUndefined()
  })

  it('обычная навигация несёт состояние текущей записи', async () => {
    const { writer, sent } = env()
    void writer.write(() => ({ url: '/films?modal=a', state: { modals: 1 } }), { replace: false })
    void writer.write((c) => ({ url: `${c.url.pathname}${c.url.search}&page=4` }), { replace: true, load: true })
    sent[0]!.done()
    await tick()
    expect(sent[1]).toMatchObject({ href: '/films?modal=a&page=4', load: true, replace: true, state: { modals: 1 } })
  })

  it('подписчики узнают о намерении сразу, о применении — после коммита', async () => {
    const { writer, sent } = env()
    let n = 0
    writer.subscribe(() => n++)
    void writer.write(() => ({ url: '/films?modal=a' }), { replace: false })
    expect(n).toBe(1)
    sent[0]!.done()
    await tick()
    expect(n).toBe(2)
    expect(writer.idle).toBe(true)
  })
})

// Ход 100: выбор в списке селекта на узком экране «откатывался» — запись
// страницы уточняла запись слоя, а закрытие слоя (свой шаг назад) возвращало на
// запись до него со старым адресом.
describe('createAddressWriter: адрес страницы переживает закрытие слоя', () => {
  function layerEnv(start = 'http://app.test/films', { withHere = true } = {}) {
    let real: AddressSnapshot = { url: new URL(start), state: {} }
    let bar = new URL(start) // адресная строка браузера
    const sent: AddressCommit[] = []
    const traversed: number[] = []
    const writer = createAddressWriter({
      read: () => real,
      commit: (step) => {
        sent.push(step)
        real = { url: new URL(step.href, real.url), state: step.state }
        bar = new URL(step.href, bar)
        return Promise.resolve()
      },
      hash: () => bar.hash,
      traverse: (delta) => traversed.push(delta),
      ...(withHere ? { here: () => new URL(bar.href) } : {}),
    })
    writer.layerKeys((k) => k === 'modal' || k.startsWith('modal.'))
    /** Браузер обошёл историю: адресная строка уже новая, `page.*` ещё нет. */
    const pop = (href: string, h = '', from?: { url: URL; hash: string }) => {
      bar = new URL(href + h, bar)
      if (!withHere) real = { url: new URL(href, real.url), state: real.state }
      writer.external(from)
    }
    /** Фреймворк применил обход. */
    const apply = (state: Record<string, unknown> = {}) => {
      real = { url: new URL(bar.pathname + bar.search, real.url), state }
      writer.applied()
    }
    const land = (href: string, state: Record<string, unknown> = {}, h = '') => {
      pop(href, h)
      apply(state)
    }
    const setHash = (h: string) => (bar.hash = h)
    return { writer, sent, traversed, pop, apply, land, setHash }
  }

  it('свой шаг назад переносит ключи страницы на запись назначения', async () => {
    const { writer, sent, traversed, pop, apply } = layerEnv()
    await writer.write((c) => ({ url: c.url, state: { list: 1 } }), { replace: false })
    await writer.write(() => ({ url: '/films?page.src=photos' }), { replace: true })
    writer.go(-1)
    expect(traversed).toEqual([-1])
    sent.length = 0
    pop('/films')
    // Обход ещё не применён: намерение (перенесённый адрес) видно сразу, без
    // мигания старого, а коммитов нет — запись оборвала бы обход фреймворка.
    expect(writer.visible().url.search).toBe('?page.src=photos')
    void writer.write((c) => ({ url: `${c.url.pathname}${c.url.search}&page=2` }), { replace: true })
    await tick()
    expect(sent).toEqual([])
    apply({})
    await tick()
    expect(sent).toEqual([
      { href: '/films?page.src=photos', state: {}, replace: true, load: false },
      { href: '/films?page.src=photos&page=2', state: {}, replace: true, load: false },
    ])
  })

  it('среда без адресной строки переносит сразу по `popstate`', async () => {
    const { writer, sent, pop } = layerEnv('http://app.test/films', { withHere: false })
    await writer.write((c) => ({ url: c.url, state: { list: 1 } }), { replace: false })
    await writer.write(() => ({ url: '/films?page.src=photos' }), { replace: true })
    writer.go(-1)
    sent.length = 0
    pop('/films')
    await tick()
    expect(sent.map((x) => x.href)).toEqual(['/films?page.src=photos'])
  })

  it('ключи слоя (цепочка ?modal=) не переносятся, но остаются у назначения', async () => {
    const { writer, sent, land } = layerEnv('http://app.test/films?modal=a')
    await writer.write(() => ({ url: '/films?modal=a&modal=b', state: { depth: 2 } }), { replace: false })
    await writer.write((c) => ({ url: `${c.url.pathname}${c.url.search}&page=3` }), { replace: true })
    writer.go(-1)
    sent.length = 0
    land('/films?modal=a', { depth: 1 })
    await tick()
    expect(sent).toEqual([{ href: '/films?page=3&modal=a', state: { depth: 1 }, replace: true, load: false }])
  })

  it('под слоем адрес страницы не менялся — записи нет', async () => {
    const { writer, sent, land } = layerEnv('http://app.test/films?page=2')
    await writer.write(() => ({ url: '/films?page=2&modal=x', state: { m: 1 } }), { replace: false })
    writer.go(-1)
    sent.length = 0
    land('/films?page=2', {})
    await tick()
    expect(sent).toEqual([])
  })

  it('чужой обход («Назад» браузера) и шаг вперёд ничего не переносят', async () => {
    const { writer, sent, land } = layerEnv()
    await writer.write(() => ({ url: '/films?page=5', state: { m: 1 } }), { replace: false })
    sent.length = 0
    land('/films', {}) // пользователь сам нажал «Назад»
    await tick()
    expect(sent).toEqual([])
    writer.go(1)
    land('/films?page=5', { m: 1 })
    await tick()
    expect(sent).toEqual([])
  })

  it('ушли на другой путь — это не закрытие слоя, переноса нет', async () => {
    const { writer, sent, land } = layerEnv('http://app.test/a')
    await writer.write(() => ({ url: '/b?page=2', state: { m: 1 } }), { replace: false })
    writer.go(-1)
    sent.length = 0
    land('/a', {})
    await tick()
    expect(sent).toEqual([])
  })

  it('якорь, поставленный под слоем, переносится', async () => {
    const { writer, sent, land, setHash } = layerEnv()
    await writer.write((c) => ({ url: c.url, state: { list: 1 } }), { replace: false })
    setHash('#faq')
    writer.go(-1)
    sent.length = 0
    land('/films', {}, '')
    await tick()
    expect(sent).toEqual([{ href: '/films#faq', state: {}, replace: true, load: false }])
  })

  it('отмена объявления: ключ снова считается ключом страницы', async () => {
    const { writer, sent, land } = layerEnv()
    const off = writer.layerKeys((k) => k === 'sheet')
    off()
    await writer.write(() => ({ url: '/films?sheet=1', state: { s: 1 } }), { replace: false })
    writer.go(-1)
    sent.length = 0
    land('/films', {})
    await tick()
    expect(sent.map((s) => s.href)).toEqual(['/films?sheet=1'])
  })

  it('системный «Назад» переносит адрес, если среда подтвердила одну стопку', async () => {
    const { writer, sent, pop, apply } = layerEnv()
    await writer.write((c) => ({ url: c.url, state: { m: 1 } }), { replace: false })
    await writer.write(() => ({ url: '/films?page.size=10' }), { replace: true })
    sent.length = 0
    // Пользователь сам нажал «Назад»; среда по связкам знает: слой → запись под ним.
    pop('/films', '', { url: new URL('http://app.test/films?page.size=10'), hash: '' })
    expect(writer.visible().url.search).toBe('?page.size=10')
    apply({})
    await tick()
    expect(sent).toEqual([{ href: '/films?page.size=10', state: {}, replace: true, load: false }])
  })

  it('«Вперёд» в слой переносит текущий адрес страницы, ключи слоя остаются его', async () => {
    const { writer, sent, pop, apply } = layerEnv('http://app.test/films?page.src=photos')
    // Браузер вернул вперёд запись модалки с устаревшими настройками страницы.
    pop('/films?page.src=products&modal=card', '', { url: new URL('http://app.test/films?page.src=photos'), hash: '' })
    expect(writer.visible().url.search).toBe('?page.src=photos&modal=card')
    apply({ modals: { depth: 1 } })
    await tick()
    expect(sent.at(-1)).toEqual({
      href: '/films?page.src=photos&modal=card',
      state: { modals: { depth: 1 } },
      replace: true,
      load: false,
    })
  })
})

