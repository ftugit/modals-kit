/**
 * Бронь ключей адреса и права (`keys.ts`) — сверка с потребителями проекта.
 * Потребители и их настоящие операции:
 *
 *   модалки   `modal`, `modal.*`  — цепочка `?modal=card,user&modal.1.pack=…`,
 *                                    пишет через писателя с владельцем «modals»
 *   пагинатор `page`, `page.*`    — `?page=2&page.size=30&page.q=…&page.filters.…`
 *   шаги      `step`, `step.*`    — `?step=fill` плюс аргументы `step.fill.id=7`
 *
 * Эквивалентность с прежним местным кодом: `chainToSearch` (modals/core.ts)
 * и перенос `carryFields` пагинатора проверены на живых потребителях.
 */
import { expect, test } from 'vitest'
import { chainToSearch, decodeChain, CHAIN_KEY } from '#lib/modals/index.js'
import { readPaginatorSearch } from '#lib/paginate/index.js'
import { carryQuery, checkKeys, claimQuery, nextSearch, readQuery, resetQueryClaims } from './keys.js'

/** Брони, как объявляют потребители при старте (адаптеры/хуки делают это сами). */
const boot = () => {
  resetQueryClaims()
  claimQuery('modals', 'modal', 'modal.*')
  claimQuery('paginate:page', 'page', 'page.*')
  claimQuery('steps', 'step', 'step.*')
}
boot()

/** Страница, где живут все потребители сразу (каталог с модалкой и шагом). */
const BUSY = '?page=2&page.size=30&page.q=fma&page.filters.kind=tv&modal=card'

/* ── бронь и права ─────────────────────────────────────────────────── */

test('бронь: тот же ключ второму владельцу не даётся, свой — можно повторно', () => {
  expect(() => claimQuery('other', 'step')).toThrow(/«steps»/)
  expect(() => claimQuery('other', 'modal.*')).toThrow(/«modals»/)
  expect(() => claimQuery('other', 'modal.1.id')).toThrow(/«modals»/) // под чужим семейством
  expect(() => claimQuery('steps', 'step', 'step.*')).not.toThrow()
})

test('права: писать можно только своё, читать — любое', () => {
  expect(() => nextSearch('steps', BUSY, { page: 3 })).toThrow(/прав нет/)
  expect(() => nextSearch('steps', BUSY, { unknown: 1 })).toThrow(/не забронирован/)
  expect(() => nextSearch('steps', BUSY, {}, { drop: ['page.filters.*'] })).toThrow(/прав нет/)
  expect(() => nextSearch('paginate:page', BUSY, { 'page.filters.kind': null })).not.toThrow()
  expect(readQuery(BUSY, 'page')).toBe('2')
  expect(readQuery(BUSY, 'modal')).toBe('card')
})

/* ── проверка правки на коммите (писатель, тот же путь) ────────────── */

test('checkKeys: сменил только своё — можно; чужое или лишнее — отклонение', () => {
  const after = nextSearch('paginate:page', BUSY, { page: 3 })
  expect(() => checkKeys('paginate:page', BUSY, after)).not.toThrow()
  expect(() => checkKeys('paginate:page', BUSY, '?page=3&modal=card,x')).toThrow(/«modal»/)
  expect(() => checkKeys('steps', BUSY, BUSY)).not.toThrow() // ничего не менял
})

/* ── шаги: href своего ключа, чужое не теряется, аргументы шага ────── */

test('шаги: href своего ключа, чужое (модалка) на месте', () => {
  expect(nextSearch('steps', '?step=build&modal=card', { step: 'fill' })).toBe('?modal=card&step=fill')
  expect(nextSearch('steps', BUSY, { step: 'result' })).toBe(
    '?page=2&page.size=30&page.q=fma&page.filters.kind=tv&modal=card&step=result',
  )
})

test('шаги: аргументы в своём семействе (как modal.1.pack у модалок)', () => {
  const out = nextSearch('steps', '?step=fill&modal=card', { 'step.fill.id': 7 })
  expect(out).toBe('?step=fill&modal=card&step.fill.id=7')
  expect(readQuery(out, 'step.fill.id')).toBe('7')
  expect(() => nextSearch('modals', out, { 'step.fill.id': 8 })).toThrow(/прав нет/)
})

/* ── пагинатор: чтение и перенос с настоящим кодом адаптера ────────── */

test('пагинатор: правка страницы, своё extra и чужое на месте', () => {
  expect(nextSearch('paginate:page', BUSY, { page: 3 })).toBe(
    '?page.size=30&page.q=fma&page.filters.kind=tv&modal=card&page=3',
  )
})

test('пагинатор: чтение совпадает с настоящим readPaginatorSearch', () => {
  const real = readPaginatorSearch(new URLSearchParams(BUSY), { pageParam: 'page' })
  expect(real.page).toBe(Number(readQuery(BUSY, 'page')))
  expect(real.pageSize).toBe(Number(readQuery(BUSY, 'page.size')))
})

test('пагинатор: сброс своих фильтров (drop семейства), остальное на месте', () => {
  expect(nextSearch('paginate:page', BUSY, {}, { drop: ['page.filters.*'] })).toBe(
    '?page=2&page.size=30&page.q=fma&modal=card',
  )
})

test('перенос no-JS: всё, кроме указателя и сброшенного, как у carryFields адаптера', () => {
  // адаптер добавляет базу и переводит относительные дропы; панель зовёт с ['filters.*']
  const adapterCarry = (from: string, drop: readonly string[]) =>
    carryQuery('paginate:page', new URLSearchParams(from), ['page', ...drop.map((d) => `page.${d}`)])
  expect(adapterCarry(BUSY, ['filters.*']).map((f) => f.name)).toEqual(['page.size', 'page.q', 'modal'])
})

/* ── модалки: эквивалентность с настоящим chainToSearch ────────────── */

const noLookup = (() => undefined) as unknown as Parameters<typeof chainToSearch>[1]

test('модалки: decode настоящей функцией читает цепочку из общего адреса', () => {
  const chain = decodeChain(BUSY, noLookup)
  expect(chain.map((e) => e.name)).toEqual(['card'])
})

test('модалки: открытие второй — результат совпадает с настоящим chainToSearch', () => {
  const base = '?page=2&modal=card'
  const real = chainToSearch(
    decodeChain(base, noLookup).concat(decodeChain('?modal=user', noLookup)),
    noLookup,
    new URLSearchParams(base),
  )
  const hook = nextSearch('modals', base, { 'modal.*': 'card,user' })
  expect(hook).toBe(real)
  expect(hook).toBe('?page=2&modal=card%2Cuser')
})

/* ── все потребители на одном адресе: никто никого не затёр ────────── */

test('без потерь: четыре правки подряд по живому адресу', () => {
  let url = BUSY
  url = nextSearch('paginate:page', url, { page: 3 })
  url = nextSearch('modals', url, { 'modal.*': 'card,user' })
  url = nextSearch('steps', url, { step: 'fill' })
  url = nextSearch('modals', url, {}, { drop: ['modal.*'] })
  expect(url).toBe('?page.size=30&page.q=fma&page.filters.kind=tv&page=3&step=fill')
  expect(readQuery(url, 'page.size')).toBe('30')
  expect(readQuery(url, 'page.filters.kind')).toBe('tv')
  expect(readQuery(url, 'modal')).toBeUndefined()
})
