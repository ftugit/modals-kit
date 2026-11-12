/**
 * Разбор намерения массового выхода. Чистая функция — без SvelteKit и базы:
 * екшен только передаёт ей значения формы и идентификатор текущей сессии.
 */
import { describe, expect, it } from 'vitest'
import { SESSION_BULK_IDS_MAX, bulkExitArgs, sessionBulkExitForm } from './sessions.form.js'

const CURRENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const THIRD = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

describe('bulkExitArgs: намерение набора', () => {
  it('без набора чекбокс выбирает scope: снят — others, отмечен — all', () => {
    expect(bulkExitArgs({ include_current: false }, CURRENT)).toEqual({
      scope: 'others',
      pick: null,
      ids: [],
    })
    expect(bulkExitArgs({ include_current: 'on' }, CURRENT).scope).toBe('all')
    // Негативный контроль: отмеченный чекбокс не оставляет `others`.
    expect(bulkExitArgs({ include_current: true }, CURRENT).scope).not.toBe('others')
  })

  it('only: снятый чекбокс убирает текущую из набора, отмеченный — оставляет', () => {
    const values = { pick: 'only', ids: [CURRENT, OTHER].join(','), include_current: false }
    expect(bulkExitArgs(values, CURRENT)).toEqual({
      scope: 'all',
      pick: 'only',
      ids: [OTHER],
    })
    expect(bulkExitArgs({ ...values, include_current: '1' }, CURRENT).ids).toEqual([CURRENT, OTHER])
  })

  it('except: снятый чекбокс добавляет текущую в исключения', () => {
    const values = { pick: 'except', ids: OTHER, include_current: false }
    expect(bulkExitArgs(values, CURRENT)).toEqual({
      scope: 'all',
      pick: 'except',
      ids: [OTHER, CURRENT],
    })
    // Отмеченный — исключений ровно столько, сколько передали.
    expect(bulkExitArgs({ ...values, include_current: 'on' }, CURRENT).ids).toEqual([OTHER])
  })

  it('без известной текущей сессии набор не меняется', () => {
    const values = { pick: 'only', ids: [CURRENT, OTHER].join(','), include_current: false }
    expect(bulkExitArgs(values, null).ids).toEqual([CURRENT, OTHER])
    expect(bulkExitArgs({ ...values, pick: 'except' }, null).ids).toEqual([CURRENT, OTHER])
  })

  it('мусор в ids не проходит, повторы схлопываются', () => {
    const raw = ['', '  ', THIRD, THIRD.toUpperCase(), OTHER].join(',')
    expect(bulkExitArgs({ pick: 'only', ids: raw, include_current: true }, CURRENT).ids).toEqual([
      THIRD,
      OTHER,
    ])
  })

  it('набор длиннее предела обрезается, вызов не падает', () => {
    const many = Array.from({ length: SESSION_BULK_IDS_MAX + 50 }, (_, i) =>
      `${String(i).padStart(8, '0')}-0000-4000-8000-000000000000`,
    )
    const args = bulkExitArgs({ pick: 'only', ids: many.join(','), include_current: true }, CURRENT)
    expect(args.ids).toHaveLength(SESSION_BULK_IDS_MAX)
  })

  it('незнакомое значение pick — не набор', () => {
    expect(bulkExitArgs({ pick: 'everything', ids: OTHER, include_current: false }, CURRENT).pick).toBeNull()
    expect(bulkExitArgs({ pick: 'ONLY', ids: OTHER, include_current: true }, CURRENT).pick).toBe('only')
  })
})

/** Поля описаны массивом: порядок объявления, у каждого есть `name`. */
function valueOf(form: ReturnType<typeof sessionBulkExitForm>, name: string): unknown {
  const field = form.fields.find((f) => f.name === name)
  return field?.defaultValue
}

describe('sessionBulkExitForm: одна форма на оба носителя', () => {
  it('чекбокс по умолчанию снят, поля набора несут переданные значения', () => {
    const form = sessionBulkExitForm({ pick: 'only', ids: [CURRENT, OTHER] })
    expect(valueOf(form, 'include_current')).toBe(false)
    expect(valueOf(form, 'pick')).toBe('only')
    expect(valueOf(form, 'ids')).toBe(`${CURRENT},${OTHER}`)
  })

  it('тот же набор полей без значений — пустая строка и снятый чекбокс', () => {
    const form = sessionBulkExitForm()
    expect(valueOf(form, 'pick')).toBe('')
    expect(valueOf(form, 'ids')).toBe('')
    expect(valueOf(form, 'include_current')).toBe(false)
  })
})
