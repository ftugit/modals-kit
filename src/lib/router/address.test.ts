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
