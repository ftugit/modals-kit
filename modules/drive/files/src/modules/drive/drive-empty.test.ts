import { describe, expect, it } from 'vitest'
import { driveEmptyOf, type DriveEmptyInput } from './drive-empty.js'

const base = (patch: Partial<DriveEmptyInput> = {}): DriveEmptyInput => ({
  step: 'list',
  mode: 'single',
  status: 'idle',
  fact: null,
  canRead: true,
  canWrite: true,
  identity: 'root',
  page: 1,
  itemCount: 0,
  totalItems: 0,
  hasFilters: false,
  hasSearch: false,
  pickedCount: 0,
  hiddenCount: null,
  isPicker: false,
  ...patch,
})

describe('driveEmptyOf: базовые причины', () => {
  it('загрузка и отказ не маскируются под Empty', () => {
    expect(driveEmptyOf(base({ status: 'loading' }))).toEqual({ component: 'skeleton' })
    expect(driveEmptyOf(base({ fact: 'auth.forbidden' }))).toEqual({ component: 'acl' })
    expect(driveEmptyOf(base({ canRead: false }))).toEqual({ component: 'acl' })
  })

  it('пустая папка, корзина и «Важное»', () => {
    expect(driveEmptyOf(base())).toMatchObject({ component: 'empty', kind: 'directory' })
    expect(driveEmptyOf(base({ identity: 'trash' }))).toMatchObject({ kind: 'trash' })
    expect(driveEmptyOf(base({ identity: 'starred' }))).toMatchObject({ kind: 'starred' })
  })

  it('фильтр важнее носителя, пикер — свой набор', () => {
    expect(driveEmptyOf(base({ hasFilters: true }))).toMatchObject({ kind: 'filtered' })
    expect(driveEmptyOf(base({ isPicker: true }))).toMatchObject({ kind: 'picker' })
    expect(driveEmptyOf(base({ isPicker: true, hasSearch: true }))).toMatchObject({
      kind: 'picker-filtered',
    })
  })

  it('неизвестный total не даёт пустоту', () => {
    expect(driveEmptyOf(base({ totalItems: null }))).toMatchObject({
      component: 'alert',
      reason: 'unknown',
    })
    expect(driveEmptyOf(base({ totalItems: 5, itemCount: 0 }))).toMatchObject({
      component: 'alert',
      reason: 'inconsistent',
    })
  })

  it('страница вне диапазона', () => {
    expect(driveEmptyOf(base({ page: 2, totalItems: 40 }))).toMatchObject({ kind: 'page' })
  })
})

describe('driveEmptyOf: шаг chosen', () => {
  const chosen = (patch: Partial<DriveEmptyInput> = {}) =>
    base({ step: 'chosen', mode: 'multiple', totalItems: null, hiddenCount: null, ...patch })

  it('пустой выбор доказан без total', () => {
    expect(driveEmptyOf(chosen({ pickedCount: 0 }))).toMatchObject({
      kind: 'chosen',
      actions: ['to-pick'],
    })
  })

  it('неизвестный total или hidden — Alert, не Empty', () => {
    expect(driveEmptyOf(chosen({ pickedCount: 2 }))).toMatchObject({ component: 'alert' })
    expect(driveEmptyOf(chosen({ pickedCount: 2, totalItems: 2 }))).toMatchObject({
      component: 'alert',
    })
  })

  it('частичное скрытие — список + hidden, полное — Empty', () => {
    expect(
      driveEmptyOf(chosen({ pickedCount: 3, totalItems: 2, hiddenCount: 1, itemCount: 2 })),
    ).toEqual({ component: 'list', hidden: 1 })
    expect(
      driveEmptyOf(chosen({ pickedCount: 2, totalItems: 0, hiddenCount: 2, itemCount: 0 })),
    ).toMatchObject({ kind: 'chosen-hidden', actions: ['to-pick'] })
  })

  it('hidden=0 показывает список, а не пустоту', () => {
    expect(
      driveEmptyOf(chosen({ pickedCount: 2, totalItems: 2, hiddenCount: 0, itemCount: 2 })),
    ).toEqual({ component: 'list' })
  })
})
