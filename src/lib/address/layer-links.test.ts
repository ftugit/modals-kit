// Связки «слой → запись под ним» (ход 106): ядро без среды.
import { describe, expect, it } from 'vitest'
import { createLayerLinks, LAYER_LINKS_STORAGE_KEY, type LinksStorage } from './layer-links'

function memory(initial: Record<string, string> = {}): LinksStorage & { data: Record<string, string> } {
  const data = { ...initial }
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v) }
}

describe('createLayerLinks', () => {
  it('назад со слоя и вперёд в слой — одна стопка, в том числе через несколько слоёв', () => {
    const links = createLayerLinks()
    links.link('modal-a', 'page')
    links.link('modal-b', 'modal-a')
    expect(links.sameStack('modal-a', 'page')).toBe(true) // назад со слоя
    expect(links.sameStack('page', 'modal-a')).toBe(true) // вперёд в слой
    expect(links.sameStack('modal-b', 'page')).toBe(true) // go(-2) через два слоя
    expect(links.sameStack('modal-b', 'modal-a')).toBe(true)
  })

  it('чужая запись (более ранняя страница) и сама запись — не одна стопка', () => {
    const links = createLayerLinks()
    links.link('modal', 'page-2')
    expect(links.sameStack('modal', 'page-1')).toBe(false)
    expect(links.sameStack('page-1', 'page-2')).toBe(false)
    expect(links.sameStack('modal', 'modal')).toBe(false)
    expect(links.sameStack('', 'page-2')).toBe(false)
  })

  it('два слоя над одной записью — не одна стопка между собой', () => {
    const links = createLayerLinks()
    links.link('first', 'page') // открыли, закрыли, открыли заново — новый ключ
    links.link('second', 'page')
    expect(links.sameStack('first', 'second')).toBe(false)
  })

  it('выпавшие из истории записи забываются', () => {
    const links = createLayerLinks()
    links.link('old-layer', 'page')
    links.link('layer', 'page')
    links.prune(['page', 'layer'])
    expect(links.snapshot()).toEqual({ layer: 'page' })
  })

  it('переживают перезагрузку через хранилище; мусор в хранилище не валит', () => {
    const storage = memory()
    const before = createLayerLinks(storage)
    before.link('layer', 'page')
    before.persist()
    expect(JSON.parse(storage.data[LAYER_LINKS_STORAGE_KEY]!)).toEqual({ layer: 'page' })
    expect(createLayerLinks(storage).sameStack('layer', 'page')).toBe(true)

    expect(createLayerLinks(memory({ [LAYER_LINKS_STORAGE_KEY]: '{oops' })).snapshot()).toEqual({})
    expect(createLayerLinks(memory({ [LAYER_LINKS_STORAGE_KEY]: '[1,2]' })).snapshot()).toEqual({})
    expect(createLayerLinks(memory({ [LAYER_LINKS_STORAGE_KEY]: '{"a":1,"b":"c"}' })).snapshot()).toEqual({ b: 'c' })
  })

  it('недоступное хранилище — связки живут в памяти', () => {
    const broken: LinksStorage = {
      getItem: () => {
        throw new Error('SecurityError')
      },
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
    }
    const links = createLayerLinks(broken)
    links.link('layer', 'page')
    expect(() => links.persist()).not.toThrow()
    expect(links.sameStack('page', 'layer')).toBe(true)
  })

  it('цикл в повреждённых данных не зацикливает проверку', () => {
    const links = createLayerLinks(memory({ [LAYER_LINKS_STORAGE_KEY]: '{"a":"b","b":"a"}' }))
    expect(links.sameStack('a', 'zzz')).toBe(false)
  })
})
