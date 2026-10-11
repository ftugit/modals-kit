import { describe, it, expect, beforeEach } from 'vitest'
import { getPaginator, resetRegistry } from '#lib/paginate/index.js'
import {
  DEMO_RELOAD_KEYS,
  DEMO_SRCS,
  demoExtraOf,
  demoHasFilterSchema,
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
