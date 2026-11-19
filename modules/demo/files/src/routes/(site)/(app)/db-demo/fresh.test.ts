import { describe, expect, it } from 'vitest'
import { FRESH_EPOCH, freshLabel, freshUrl, mergeFresh } from './fresh'

const row = (id: string): { id: string; title: string; created_at: string } => ({
  id,
  title: id,
  created_at: '2026-10-14T12:00:00.000Z',
})

describe('опрос «что появилось»', () => {
  it('адрес: без отметки — базовый вопрос, пустая выдача — от начала времён, фильтр едет с ним', () => {
    expect(freshUrl(undefined, undefined)).toBe('/api/db-posts?since=')
    expect(freshUrl(undefined, null)).toBe(`/api/db-posts?since=${encodeURIComponent(FRESH_EPOCH)}`)
    const url = new URL(freshUrl('{"field":"title"}', '2026-10-14T12:00:00.123Z'), 'http://x')
    expect(url.searchParams.get('since')).toBe('2026-10-14T12:00:00.123Z')
    expect(url.searchParams.get('flt')).toBe('{"field":"title"}')
    // Ключей страницы в вопросе нет: сервер на них ответит 422.
    expect([...url.searchParams.keys()].sort()).toEqual(['flt', 'since'])
  })

  it('ожидающие: без строки-отметки, без известных, без повторов, свежие первыми', () => {
    const known = new Set(['own', 'shown'])
    const first = mergeFresh([], [row('b'), row('own'), row('mark'), row('shown')], {
      markId: 'mark',
      known: (id) => known.has(id),
    })
    expect(first.map((r) => r.id)).toEqual(['b'])
    const second = mergeFresh(first, [row('c'), row('b')], { markId: 'mark', known: (id) => known.has(id) })
    expect(second.map((r) => r.id)).toEqual(['c', 'b'])
    // Ничего нового — та же ссылка: реактивности незачем просыпаться.
    expect(mergeFresh(second, [row('b')], { markId: null, known: () => false })).toBe(second)
  })

  it('потолок ответа: в ожидании не больше 50, подпись — «50+»', () => {
    const many = Array.from({ length: 60 }, (_, i) => row(`r${i}`))
    expect(mergeFresh([], many, { markId: null, known: () => false })).toHaveLength(50)
    expect(freshLabel(50)).toBe('↑ 50+ новых записей — показать')
  })

  it('подпись склоняется по-русски', () => {
    expect(freshLabel(1)).toBe('↑ 1 новая запись — показать')
    expect(freshLabel(3)).toBe('↑ 3 новые записи — показать')
    expect(freshLabel(5)).toBe('↑ 5 новых записей — показать')
    expect(freshLabel(11)).toBe('↑ 11 новых записей — показать')
    expect(freshLabel(22)).toBe('↑ 22 новые записи — показать')
  })
})
