import { describe, expect, it } from 'vitest'
import { sessionDeleteForm, sessionDeleteSummary, sliceFieldName } from './form.js'
import { SESSION_DELETE_SLICE_KEYS } from '../../model/session-delete.js'

describe('подтверждение закрытия устройств', () => {
  it('одно устройство — словами, без удержания', () => {
    const s = sessionDeleteSummary({ count: 1, slice: false, variant: 'delete' })
    expect(s.title).toBe('Закрыть это устройство?')
    expect(s.hold).toBe(false)
  })

  it('набор больше одного — число и удержание', () => {
    expect(sessionDeleteSummary({ count: 3, slice: false, variant: 'delete' })).toMatchObject({
      title: 'Закрыть 3 устройства?',
      hold: true,
    })
    expect(sessionDeleteSummary({ count: 5, slice: false, variant: 'delete' }).title).toBe('Закрыть 5 устройств?')
    expect(sessionDeleteSummary({ count: 21, slice: false, variant: 'delete' }).title).toBe('Закрыть 21 устройство?')
  })

  it('срез всегда требует удержания: число строк знает только сервер', () => {
    const s = sessionDeleteSummary({ count: 0, slice: true, variant: 'delete' })
    expect(s.title).toBe('Закрыть все устройства в этом срезе?')
    expect(s.hold).toBe(true)
  })

  it('вариант «выйти» меняет глагол, а не разметку', () => {
    expect(sessionDeleteSummary({ count: 1, slice: false, variant: 'logout' }).title).toBe('Выйти это устройство?')
    expect(sessionDeleteSummary({ count: 2, slice: false, variant: 'logout' }).title).toBe('Выйти 2 устройства?')
  })

  it('негативный контроль: правило удержания привязано к числу, а не к принадлежности', () => {
    // Мутация «удержание для чужих» или «удержание всегда» проваливает эти две проверки.
    expect(sessionDeleteSummary({ count: 1, slice: false, variant: 'delete' }).hold).toBe(false)
    expect(sessionDeleteSummary({ count: 2, slice: false, variant: 'delete' }).hold).toBe(true)
  })
})

describe('описание формы', () => {
  it('одно на клиент и сервер: набор, вариант и ключи среза объявлены всегда', () => {
    const form = sessionDeleteForm()
    const names = form.fields.map((f) => f.name)
    expect(names).toContain('ids')
    expect(names).toContain('variant')
    for (const key of SESSION_DELETE_SLICE_KEYS) expect(names).toContain(sliceFieldName(key))
    expect(names).toHaveLength(2 + SESSION_DELETE_SLICE_KEYS.length)
  })

  it('строится одинаково при повторном вызове (ревизия не зависит от адреса)', () => {
    expect(JSON.stringify(sessionDeleteForm())).toBe(JSON.stringify(sessionDeleteForm()))
  })

  it('негативный контроль: ключ среза не совпадает с ключом списка', () => {
    // Мутация «слать фильтр под его собственным именем» смешала бы срез с наборами.
    expect(sliceFieldName('state')).not.toBe('state')
  })
})
