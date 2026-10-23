/**
 * Локальный корпус демо: поиск по названию — механизм данных, который источник
 * объявляет своей возможностью (`search` в спеке `defineSource`).
 *
 * Ключевое: сужение идёт ДО пагинации, поэтому `totalItems`/`totalPages`
 * считаются по найденному — источник остаётся честным пагинатором, а не
 * «фильтром одной страницы».
 */
import { describe, expect, it } from 'vitest'
import { GALLERY, PRODUCTS, queryItemsPage } from './items'

describe('локальный корпус: поиск по названию', () => {
  it('без запроса — обычная пагинация всего корпуса', () => {
    const page = queryItemsPage('products', { page: 2, pageSize: 20 })
    expect(page.items.length).toBe(20)
    expect(page.totalItems).toBe(PRODUCTS.length)
    expect(page.totalPages).toBe(Math.ceil(PRODUCTS.length / 20))
    expect(page.items[0].id).toBe(21)
  })

  it('запрос сужает корпус до пагинации: totals — по найденному', () => {
    const expected = PRODUCTS.filter((p) => p.title.toLowerCase().includes('product 29'))
    expect(expected.length).toBe(11) // «Product 29» и «Product 290»…«Product 299»
    const first = queryItemsPage('products', { page: 1, pageSize: 5, q: 'Product 29' })
    expect(first.totalItems).toBe(11)
    expect(first.totalPages).toBe(3)
    expect(first.items.length).toBe(5)
    const last = queryItemsPage('products', { page: 3, pageSize: 5, q: 'Product 29' })
    expect(last.items.length).toBe(1)
    expect(last.items.every((item) => (item as { title: string }).title.includes('Product 29'))).toBe(true)
  })

  it('регистр и внешние пробелы не важны, пустой запрос = весь корпус', () => {
    expect(queryItemsPage('products', { page: 1, pageSize: 5, q: '  pRoDuCt 29  ' }).totalItems).toBe(11)
    expect(queryItemsPage('products', { page: 1, pageSize: 5, q: '   ' }).totalItems).toBe(PRODUCTS.length)
    expect(queryItemsPage('products', { page: 1, pageSize: 5 }).totalItems).toBe(PRODUCTS.length)
  })

  it('ничего не найдено — пустая страница с нулевыми totals (не ошибка)', () => {
    const page = queryItemsPage('products', { page: 1, pageSize: 5, q: 'аквадискотека' })
    expect(page.items).toEqual([])
    expect(page.totalItems).toBe(0)
    expect(page.totalPages).toBe(0)
  })

  it('фото ищутся так же по подписи, но источник эту возможность не объявляет', () => {
    const expected = GALLERY.filter((p) => p.caption.toLowerCase().includes('photo 5'))
    expect(expected.length).toBe(11) // «Photo 5» и «Photo 50»…«Photo 59»
    expect(queryItemsPage('photos', { page: 1, pageSize: 5, q: 'photo 5' }).totalItems).toBe(11)
  })
})
