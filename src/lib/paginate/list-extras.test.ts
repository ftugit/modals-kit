import { describe, expect, it } from 'vitest'
import { defineListExtras, extraField } from './index.js'

/** Адресная спека «как у списка устройств»: фильтры без `q`, плюс внутренние ключи. */
const searchable = {
  state: extraField('text'),
  net: extraField('text'),
  country: extraField('text'),
}
const defaults = { state: 'active', net: '', country: '' }

describe('defineListExtras (P2-2)', () => {
  it('выводит filterKeys и reloadKeys из адресных и внутренних ключей', () => {
    const extras = defineListExtras({
      searchable,
      internal: ['_uid', '_journal'],
      defaults,
    })
    // Источник понимает адресные фильтры и внутренние ключи цели.
    expect([...extras.filterKeys]).toEqual(['state', 'net', 'country', '_uid', '_journal'])
    // Смена любого из них пересобирает выдачу.
    expect([...extras.reloadKeys]).toEqual(['state', 'net', 'country', '_uid', '_journal'])
    expect([...extras.searchableKeys]).toEqual(['state', 'net', 'country'])
    expect([...extras.internalKeys]).toEqual(['_uid', '_journal'])
  })

  it('внутренние ключи не попадают в адресную спеку (extraSearch)', () => {
    const extras = defineListExtras({ searchable, internal: ['_uid', '_journal'], defaults })
    // extraSearch — та же ссылка, что передана; внутренних ключей в ней нет.
    expect(extras.extraSearch).toBe(searchable)
    expect(Object.keys(extras.extraSearch)).toEqual(['state', 'net', 'country'])
    expect(Object.keys(extras.extraSearch)).not.toContain('_uid')
    expect(Object.keys(extras.extraSearch)).not.toContain('_journal')
    expect(extras.extraDefaults).toBe(defaults)
  })

  it('`q` родного поиска входит в reloadKeys, но не в filterKeys источника', () => {
    const withSearch = { q: extraField('text'), ord: extraField('text'), ids: extraField('text') }
    const extras = defineListExtras({ searchable: withSearch })
    // defineSource сам добавит `q` при объявленном search — в фильтры он не входит.
    expect([...extras.filterKeys]).toEqual(['ord', 'ids'])
    // Но смена запроса пересобирает выдачу.
    expect([...extras.reloadKeys]).toEqual(['q', 'ord', 'ids'])
  })

  it('без внутренних ключей filterKeys — адресные ключи без `q`', () => {
    const extras = defineListExtras({ searchable })
    expect([...extras.filterKeys]).toEqual(['state', 'net', 'country'])
    expect([...extras.reloadKeys]).toEqual(['state', 'net', 'country'])
    expect([...extras.internalKeys]).toEqual([])
    expect(extras.extraDefaults).toEqual({})
  })

  it('пересечение адресного и внутреннего ключа — ошибка описания', () => {
    expect(() => defineListExtras({ searchable, internal: ['state'] })).toThrow(
      /объявлен и адресным, и внутренним/,
    )
  })
})
