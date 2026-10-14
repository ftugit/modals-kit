import { describe, it, expect, beforeEach } from 'vitest'
import { getPaginator, resetRegistry } from '#lib/paginate/index.js'
import {
  DEMO_RELOAD_KEYS,
  DEMO_SRCS,
  demoExtraOf,
  demoHasFilterSchema,
  demoShikimoriApi,
  demoStaticFilterSchema,
  ensureDemoPaginator,
} from './definition'
import { RICKMORTY_FILTER_SCHEMA } from '../../../../content/rickmorty-filters'

/**
 * Пункт «БД» в демо-пагинаторе проверяется здесь, а не только браузером:
 * выбор источника, связь опции курсора с ним и то, что он НЕ притворяется
 * живым каталогом Shikimori, — это решения определителя, и они должны быть
 * видны тестом, а не только глазами на странице.
 */
describe('демо-пагинатор: источник БД и его режим курсора', () => {
  beforeEach(() => {
    resetRegistry()
  })

  it('`db` — объявленный источник панели', () => {
    expect(DEMO_SRCS).toContain('db')
    expect(demoExtraOf({ src: 'db' }).src).toBe('db')
    // Мусор в адресе не становится источником: deny-safe разбор остаётся разбором.
    expect(demoExtraOf({ src: 'postgres' }).src).toBe('products')
  })

  it('курсор — возможность источника: totals снимаются только у БД', () => {
    const name = ensureDemoPaginator('url')
    const adapter = getPaginator(name).adapter
    expect(adapter.capabilitiesFor({ src: 'db' }).totals).toBe(true)
    expect(adapter.capabilitiesFor({ src: 'db', cur: true }).totals).toBe(false)
    // Товары и фото тумблер курсора не получают: у них указателя следующего шага нет,
    // и «включённая вхолостую» опция была бы обманом панели.
    expect(adapter.capabilitiesFor({ src: 'products', cur: true }).totals).toBe(true)
  })

  it('схема фильтров живого каталога не назначается БД', () => {
    expect(demoHasFilterSchema('animes')).toBe(true)
    expect(demoHasFilterSchema('db')).toBe(false)
    expect(demoHasFilterSchema('photos')).toBe(false)
    expect(demoHasFilterSchema(undefined)).toBe(false)
  })

  it('`cur` меняет выдачу, `after` — только указатель', () => {
    expect(DEMO_RELOAD_KEYS).toContain('cur')
    expect(DEMO_RELOAD_KEYS).not.toContain('after')
  })
})

describe('демо-пагинатор: Rick and Morty (REST и GraphQL)', () => {
  beforeEach(() => {
    resetRegistry()
  })

  it('обе версии — один источник с одной статической схемой и общими ключами', () => {
    expect(DEMO_SRCS).toEqual(expect.arrayContaining(['rm-rest', 'rm-graphql']))
    expect(demoStaticFilterSchema('rm-rest')).toBe(RICKMORTY_FILTER_SCHEMA)
    expect(demoStaticFilterSchema('rm-graphql')).toBe(RICKMORTY_FILTER_SCHEMA)
    expect(demoStaticFilterSchema('animes')).toBeNull()
    expect(demoStaticFilterSchema('db')).toBeNull()
    expect(DEMO_RELOAD_KEYS).toEqual(expect.arrayContaining(['filters.gender', 'filters.species', 'filters.type']))
    // Смена версии меняет только `src`: фильтры и запрос в extra остаются теми же.
    const extra = { src: 'rm-rest', q: 'rick', 'filters.status': 'alive', 'filters.species': 'Human' }
    const switched = demoExtraOf({ ...extra, src: 'rm-graphql' })
    expect(switched).toMatchObject({ src: 'rm-graphql', q: 'rick', 'filters.status': 'alive', 'filters.species': 'Human' })
  })

  it('totals есть, курсора нет: тумблер `cur` не снимает номера страниц', () => {
    const adapter = getPaginator(ensureDemoPaginator('url')).adapter
    for (const src of ['rm-rest', 'rm-graphql']) {
      expect(adapter.capabilitiesFor({ src }).totals).toBe(true)
      expect(adapter.capabilitiesFor({ src, cur: true }).totals).toBe(true)
      expect(adapter.capabilitiesFor({ src }).filters).toEqual({ keys: ['filters.status', 'filters.gender', 'filters.species', 'filters.type'] })
    }
  })
})

describe('демо-пагинатор: Shikimori в трёх версиях API (ход 85)', () => {
  beforeEach(() => {
    resetRegistry()
  })

  it('animes — mix (адреса до разделения читаются по-старому), плюс rest и graphql', () => {
    expect(DEMO_SRCS).toEqual(expect.arrayContaining(['animes', 'animes-rest', 'animes-graphql']))
    expect(demoShikimoriApi('animes')).toBe('mix')
    expect(demoShikimoriApi('animes-rest')).toBe('rest')
    expect(demoShikimoriApi('animes-graphql')).toBe('graphql')
    expect(demoShikimoriApi('rm-rest')).toBeNull()
    expect(demoShikimoriApi(undefined)).toBeNull()
    for (const src of ['animes', 'animes-rest', 'animes-graphql'] as const) {
      expect(demoHasFilterSchema(src)).toBe(true)
      expect(demoStaticFilterSchema(src)).toBeNull()
    }
  })

  it('у graphql нет ключей студий: возможность фильтров объявляет сама версия', () => {
    const adapter = getPaginator(ensureDemoPaginator('url')).adapter
    const keysOf = (src: string) => {
      const filters = adapter.capabilitiesFor({ src }).filters
      return filters ? filters.keys : []
    }
    expect(keysOf('animes')).toEqual(expect.arrayContaining(['filters.studios.and', 'filters.studios.not']))
    expect(keysOf('animes-rest')).toEqual(keysOf('animes'))
    expect(keysOf('animes-graphql').some((key) => key.startsWith('filters.studios'))).toBe(false)
    expect(keysOf('animes-graphql')).toEqual(expect.arrayContaining(['filters.genres.and', 'filters.kind']))
  })
})
