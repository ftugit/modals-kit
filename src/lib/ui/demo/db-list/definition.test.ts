import { describe, it, expect } from 'vitest'
import {
  DB_LIST_EXTRA_SEARCH,
  DB_LIST_ORDER_DEFAULT,
  DB_LIST_PAGE_SIZE,
  dbListExtraOf,
  dbPostsCursorSource,
  dbPostsSource,
  isCursorOn,
  setDbPostsServerTransport,
  type DbPostsQuery,
} from './definition'

/**
 * Разбор адреса источника БД — тестами, а не браузером: это та часть, где
 * «тот же источник на двух страницах» и расходится, если ключи режима
 * трактуются по-разному в панели, в URL и в запросе к слою.
 */
describe('адрес источника БД: страницы и курсор одним словарём', () => {
  it('`?page.cur` включает режим с адресного значения, а не только с JS-панели', () => {
    // JS: панель пишет настоящий boolean. Нативный GET: чекбокс приезжает как `on`
    // (`lib/form/builtins.ts`), и «только boolean» отсёк бы именно путь без JS.
    expect(dbListExtraOf({ cur: true }).cur).toBe(true)
    expect(dbListExtraOf({ cur: 'on' }).cur).toBe(true)
    expect(isCursorOn({ cur: 'on' })).toBe(true)
    // Снятый флаг = ключа нет = дефолт «страницы».
    expect(dbListExtraOf({}).cur).toBe(false)
    expect(dbListExtraOf({ cur: 'false' }).cur).toBe(false)
    expect(isCursorOn({})).toBe(false)
  })

  it('сортировка умеет быть «как в слое» и только валидным JSON-порядком', () => {
    expect(dbListExtraOf({}).ord).toBe(DB_LIST_ORDER_DEFAULT)
    expect(dbListExtraOf({ ord: DB_LIST_ORDER_DEFAULT }).ord).toBe(DB_LIST_ORDER_DEFAULT)
    expect(dbListExtraOf({ ord: '[["title","asc"]]' }).ord).toBe('[["title","asc"]]')
    // Мусор и «title:asc» (не форма слоя) в extra не попадают: их обязан отсечь
    // адрес, а не молча доехать до `parseListInput`.
    expect(dbListExtraOf({ ord: 'title:asc' }).ord).toBe(DB_LIST_ORDER_DEFAULT)
    expect(dbListExtraOf({ ord: '[["title","up"]]' }).ord).toBe(DB_LIST_ORDER_DEFAULT)
  })

  it('указатель следующего шага проверяется по форме, а не по смыслу', () => {
    const validate = DB_LIST_EXTRA_SEARCH.after!
    const token = 'eyJ2IjoxLCJzIjoiZGVtby5wb3N0LnYxIiwidiI6WyIxIl19.sig'
    expect(validate(token)).toBe(token)
    expect(validate('')).toBeUndefined()
    expect(validate('a b')).toBeUndefined() // пробел или управляющий символ — не токен
    expect(validate('x'.repeat(513))).toBeUndefined() // длина ограничена
  })

  it('источник выбирает транспорт по наличию указателя: `after` важнее номера', async () => {
    const seen: DbPostsQuery[] = []
    setDbPostsServerTransport(async (query) => {
      seen.push(query)
      return { items: [], hasNext: false }
    })
    await dbPostsSource.fetchPage({ page: 3, pageSize: DB_LIST_PAGE_SIZE }, { ord: DB_LIST_ORDER_DEFAULT })
    expect(seen[0]).toMatchObject({ page: 3, after: undefined, order: undefined })
    await dbPostsSource.fetchPage({ page: 4, pageSize: DB_LIST_PAGE_SIZE }, { after: 'T-3' })
    expect(seen[1]).toMatchObject({ page: 4, after: 'T-3' })
  })

  it('курсорная возможность: с `cur` полных totals нет, и UI гасит номера сам', async () => {
    expect(dbPostsSource.capabilitiesFor({}).totals).toBe(true)
    expect(dbPostsCursorSource.capabilitiesFor({ cur: true }).totals).toBe(false)
    expect(dbPostsCursorSource.capabilitiesFor({ cur: false }).totals).toBe(true)
    // Указатель следующего шага переживает источник: ядро кладёт его в extra,
    // и именно он попадает в ссылку «дальше».
    setDbPostsServerTransport(async () => ({ items: [], hasNext: true, extra: { after: 'T-1' } }))
    const resp = await dbPostsCursorSource.fetchPage({ page: 1, pageSize: 5 }, { cur: true })
    expect(resp.extra).toEqual({ after: 'T-1' })
  })
})
