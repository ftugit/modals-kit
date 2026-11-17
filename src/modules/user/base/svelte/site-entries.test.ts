// Входы с главной (S22): видимость по праву, адреса из реестра, одна кнопка на
// два носителя. Чистое описание — без SvelteKit и разметки.
import { describe, expect, test } from 'vitest'
import { blocksListRoute, sessionsJournalRoute } from '../routes.js'
import { siteListEntries } from './site-entries.js'

describe('siteListEntries: видимость по праву', () => {
  test('без прав входов нет, гость не получает карточек', () => {
    expect(siteListEntries([])).toEqual([])
    expect(siteListEntries(null)).toEqual([])
    expect(siteListEntries(undefined)).toEqual([])
  })

  test('круг журнала видит журнал, но не блокировки', () => {
    const keys = siteListEntries(['session.read']).map((e) => e.key)
    expect(keys).toEqual(['journal'])
  })

  test('круг чтения блокировок видит блокировки, но не журнал', () => {
    const keys = siteListEntries(['block.read']).map((e) => e.key)
    expect(keys).toEqual(['blocks'])
  })

  test('админ видит оба входа', () => {
    expect(siteListEntries(['admin']).map((e) => e.key)).toEqual(['journal', 'blocks'])
  })

  test('чужое право входов не открывает', () => {
    // Негативный контроль: право другой модели не открывает ни одного входа.
    expect(siteListEntries(['auth.edit'])).toEqual([])
    // `block.edit` не чужое — оно подразумевает чтение строки.
    expect(siteListEntries(['block.edit']).map((e) => e.key)).toEqual(['blocks'])
  })
})

describe('siteListEntries: адреса и носители', () => {
  test('адреса берутся из реестра маршрутов', () => {
    const [journal, blocks] = siteListEntries(['admin'])
    expect(journal?.href).toBe(sessionsJournalRoute.href())
    expect(blocks?.href).toBe(blocksListRoute.href())
  })

  test('у журнала есть модалка (одна кнопка на два носителя), у блокировок — только страница', () => {
    const [journal, blocks] = siteListEntries(['admin'])
    expect(journal?.modal).toBe('user.sessions.journal')
    expect(blocks?.modal).toBeNull()
  })
})
