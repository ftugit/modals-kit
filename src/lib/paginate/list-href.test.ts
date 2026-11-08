import { beforeEach, describe, expect, it } from 'vitest'
import { createUrlAdapter, definePaginator, extraField, resetRegistry } from './index.js'
import { listHref } from './list-href.js'
import { defineSource } from './source.js'

const source = defineSource({
  name: 'list-href-source',
  record: { id: () => '', title: () => '', texts: () => [] },
  data: async () => ({ items: [] as string[] }),
})

function define(name: string) {
  definePaginator({
    name,
    pageSize: 30,
    adapter: createUrlAdapter({
      name,
      source,
      pageParam: 'users',
      pageSize: 30,
      extraSearch: { q: extraField('text'), ord: extraField('text') },
      extraDefaults: { q: '', ord: 'created-desc' },
    }),
  })
}

describe('listHref', () => {
  beforeEach(() => {
    resetRegistry()
  })

  it('пишет срез адаптером и сохраняет чужие ключи', () => {
    define('list-href-users')
    expect(
      listHref(
        'list-href-users',
        '/users?modal=user.list&users.ord=id-asc&users=3',
        { q: 'ada', ord: undefined },
      ),
    ).toBe('/users?modal=user.list&users.q=ada')
  })

  it('размер по умолчанию снимает ключ, отличный пишет', () => {
    define('list-href-size')
    expect(listHref('list-href-size', '/users?users.size=50', {}, 30)).toBe('/users')
    expect(listHref('list-href-size', '/users', {}, 40)).toBe('/users?users.size=40')
  })

  it('неизвестный пагинатор и чужой адрес — null, не GET', () => {
    expect(listHref('missing', '/users', {})).toBeNull()
    define('list-href-local')
    expect(listHref('list-href-local', 'https://evil.test/users', {})).toBeNull()
    expect(listHref('list-href-local', '//evil.test/users', {})).toBeNull()
  })
})
