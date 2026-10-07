/**
 * Родной поиск демо-источников (`content/items.ts`): товары ищутся по названию
 * подстрокой без учёта регистра — это возможность САМОГО источника (этап 2),
 * поверх неё lib/search может подключиться декоратором. У фото родного поиска
 * нет: `q` им не передаётся (оболочка пагинатора не отдаёт запрос источнику без
 * возможности), поэтому и фильтра в массиве фото нет.
 */
import { describe, expect, it } from 'vitest'
import { getItemsPage, GALLERY, PRODUCTS, queryItemsPage } from './items'

describe('источник товаров: родной поиск по названию', () => {
  it('без запроса отдаёт каталог целиком с честными тоталами', () => {
    const page = queryItemsPage('products', { page: 1, pageSize: 5 })
    expect(page.items).toHaveLength(5)
    expect(page.items[0]).toEqual({ id: 1, title: 'Product 1', price: PRODUCTS[0].price })
    expect(page.totalItems).toBe(PRODUCTS.length)
    expect(page.totalPages).toBe(Math.ceil(PRODUCTS.length / 5))
  })

  it('подстрока по названию, регистр и пробелы не важны', () => {
    const exact = queryItemsPage('products', { page: 1, pageSize: 20, q: 'Product 42' })
    expect(exact.items.map((i) => i.id)).toEqual([42])
    expect(exact.totalItems).toBe(1)
    expect(exact.totalPages).toBe(1)

    const upper = queryItemsPage('products', { page: 1, pageSize: 20, q: 'PRODUCT 42' })
    expect(upper.items.map((i) => i.id)).toEqual([42])

    const padded = queryItemsPage('products', { page: 1, pageSize: 20, q: '   product 42   ' })
    expect(padded.items.map((i) => i.id)).toEqual([42])
  })

  it('пагинация идёт по найденному, а не по всему массиву', () => {
    // «Product 2» — это id 2, 20…29 и 200…299: 1 + 10 + 100 = 111 записей.
    const found = queryItemsPage('products', { page: 1, pageSize: 10, q: 'product 2' })
    expect(found.totalItems).toBe(111)
    expect(found.totalPages).toBe(12)
    expect(found.items.map((i) => i.id)).toEqual([2, 20, 21, 22, 23, 24, 25, 26, 27, 28])

    const second = queryItemsPage('products', { page: 2, pageSize: 10, q: 'product 2' })
    expect(second.items.map((i) => i.id)).toEqual([29, 200, 201, 202, 203, 204, 205, 206, 207, 208])
  })

  it('ничего не найдено — пустая страница и нулевые тоталы (без выдумок)', () => {
    const empty = queryItemsPage('products', { page: 1, pageSize: 20, q: 'нет такого товара' })
    expect(empty.items).toEqual([])
    expect(empty.totalItems).toBe(0)
    expect(empty.totalPages).toBe(0)
  })

  it('запрос доходит и через async-обёртку источника', async () => {
    // «product 7» — это Product 7 и Product 70…79: подстрока, а не совпадение целиком.
    const page = await getItemsPage({ kind: 'products', page: 1, pageSize: 20, q: 'product 7' })
    expect(page.items.map((i) => i.id)).toEqual([7, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79])
    expect(page.totalItems).toBe(11)
  })

  it('отмена до/во время запроса — AbortError', async () => {
    const aborted = new AbortController()
    aborted.abort()
    await expect(
      getItemsPage({ kind: 'products', page: 1, pageSize: 20, signal: aborted.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('источник фото: «просто данные»', () => {
  it('запрос игнорируется — фильтра по подписям у него нет', () => {
    const page = queryItemsPage('photos', { page: 1, pageSize: 5, q: 'Photo 5' })
    expect(page.items.map((i) => i.id)).toEqual([1, 2, 3, 4, 5])
    expect(page.totalItems).toBe(GALLERY.length)
  })
})
