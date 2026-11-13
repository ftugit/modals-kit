import { describe, expect, test } from 'vitest'
import { SESSION_BULK_IDS_MAX, bulkExitArgs, sessionBulkExitForm } from './sessions.form.js'
import { SESSIONS_BULK_IDS_LIMIT } from './types.js'

const CURRENT = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'

const valueOf = (form: ReturnType<typeof sessionBulkExitForm>, name: string): unknown =>
  form.byName[name]?.defaultValue

describe('bulkExitArgs: серверный набор по фильтру, без клиентских ids', () => {
  test('список: чекбокс меняет includeCurrent, состав не читается из ids/pick', () => {
    const values = { ids: [CURRENT, OTHER].join(','), pick: 'only', include_current: false, state: 'expired' }
    const args = bulkExitArgs(values, CURRENT)
    expect(args.includeCurrent).toBe(false)
    expect(args.onlyCurrent).toBe(false)
    expect(args.except).toEqual([])
    expect(args.where.state).toBe('expired')
    expect(bulkExitArgs({ ...values, include_current: 'on' }, CURRENT).includeCurrent).toBe(true)
  })

  test('фильтр списка разбирается из POST: страна, сеть, даты', () => {
    const args = bulkExitArgs(
      { state: 'all', country: 'ru,none', net: '1', cfrom: '2026-01-01T00:00', cto: '2026-02-01T00:00' },
      CURRENT,
    )
    expect(args.where.state).toBe('all')
    expect(args.where.country).toEqual(['RU', 'none'])
    expect(args.where.subnetChanged).toBe(true)
    expect(args.where.createdFrom).toBe(Date.parse('2026-01-01T00:00'))
    expect(args.where.createdTo).toBe(Date.parse('2026-02-01T00:00'))
  })

  test('мусорное состояние не проходит; пустой фильтр — без состояния', () => {
    expect(bulkExitArgs({ state: 'everything' }, CURRENT).where.state).toBeUndefined()
    expect(bulkExitArgs({}, CURRENT).where.state).toBeUndefined()
  })

  test('предел исключений — одно объявление домена', () => {
    expect(SESSION_BULK_IDS_MAX).toBe(SESSIONS_BULK_IDS_LIMIT)
    expect(SESSION_BULK_IDS_MAX).toBe(500)
  })
})

describe('bulkExitArgs: экран выхода (spread) инвертирует чекбокс', () => {
  test('снятый чекбокс — только текущая сессия, id сервер знает сам', () => {
    const args = bulkExitArgs({ spread: '1', include_current: false, ids: OTHER }, CURRENT)
    expect(args.onlyCurrent).toBe(true)
    expect(args.includeCurrent).toBe(false)
    expect(args.where.state).toBe('active')
    expect(args.except).toEqual([])
  })

  test('отмеченный чекбокс — весь активный срез аккаунта', () => {
    const args = bulkExitArgs({ spread: '1', include_current: 'on' }, CURRENT)
    expect(args.onlyCurrent).toBe(false)
    expect(args.includeCurrent).toBe(true)
    expect(args.where.state).toBe('active')
  })

  test('без текущей сессии снятый чекбокс всё равно только текущая (домен откажет)', () => {
    const args = bulkExitArgs({ spread: '1', include_current: false }, null)
    expect(args.onlyCurrent).toBe(true)
  })
})

describe('sessionBulkExitForm: поля набора', () => {
  test('нет клиентских ids/pick; есть фильтр и spread', () => {
    const form = sessionBulkExitForm({ filters: { state: 'expired', country: 'RU' } })
    expect(form.byName.ids).toBeUndefined()
    expect(form.byName.pick).toBeUndefined()
    expect(valueOf(form, 'state')).toBe('expired')
    expect(valueOf(form, 'country')).toBe('RU')
    expect(valueOf(form, 'spread')).toBe('')
    expect(form.revision).toBe(3)
  })

  test('spread экрана выхода', () => {
    expect(valueOf(sessionBulkExitForm({ spread: true }), 'spread')).toBe('1')
  })
})
