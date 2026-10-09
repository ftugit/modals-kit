import { describe, expect, it } from 'vitest'
import { matchesSelectOption, selectedAfterToggle, type SelectOption } from './select-model'
import { DEFAULT_SELECT_CONFIG } from './Select.svelte'

const option = (value: string, label: string, hint?: string): SelectOption => ({ value, label, hint })

describe('выбор вариантов select', () => {
  const items = [option('a', 'A'), option('b', 'B'), { ...option('locked', 'Locked'), disabled: true }]

  it('single повторно нажимает текущий вариант как toggle, другой заменяет выбор', () => {
    expect(selectedAfterToggle([], items[0]!, false)).toEqual([items[0]])
    expect(selectedAfterToggle([items[0]!], items[0]!, false)).toEqual([])
    expect(selectedAfterToggle([items[0]!], items[1]!, false)).toEqual([items[1]])
  })

  it('не снимает disabled вариант и сохраняет поведение multi', () => {
    expect(selectedAfterToggle([items[0]!], items[2]!, false)).toEqual([items[0]])
    expect(selectedAfterToggle([], items[0]!, true)).toEqual([items[0]])
    expect(selectedAfterToggle([items[0]!], items[0]!, true)).toEqual([])
  })
})

describe('поиск по вариантам select', () => {
  const genres = [option('27', 'Сёнен'), option('133', 'Романтика'), option('42', 'Сэйнэн')]

  it('режим value ищет по значению и не находит по подписи', () => {
    expect(matchesSelectOption(genres[0], '27', 'value')).toBe(true)
    expect(matchesSelectOption(genres[1], 'романтика', 'value')).toBe(false)
  })

  it('режим label ищет по подписи и не находит по значению', () => {
    expect(matchesSelectOption(genres[1], 'ром', 'label')).toBe(true)
    expect(matchesSelectOption(genres[1], '133', 'label')).toBe(false)
  })

  it('режим по умолчанию находит подпись — в интерфейсе ищут то, что видят', () => {
    // 🔴 Контракт приложения: значением служит идентификатор из справочника
    // источника («27» у жанра), поэтому режим по умолчанию обязан находить
    // ПОДПИСЬ. Регрессия, которую ловим: поиск по «романтика» не находил
    // ничего, потому что работал только по значению.
    for (const genre of genres) {
      expect(matchesSelectOption(genre, genre.label, DEFAULT_SELECT_CONFIG.search)).toBe(true)
    }
    expect(matchesSelectOption(genres[1], '133', DEFAULT_SELECT_CONFIG.search)).toBe(true)
  })

  it('находит подпись без «ё» и без учёта регистра', () => {
    expect(matchesSelectOption(genres[0], 'сенен', 'label')).toBe(true)
    // «й» разлагается на «и» + кратка, поэтому «сэйнэн» находится и без неё.
    expect(matchesSelectOption(genres[2], 'сэинэн', 'label')).toBe(true)
    expect(matchesSelectOption(genres[2], 'сэйнэн', 'label')).toBe(true)
    expect(matchesSelectOption(genres[1], 'РОМАНТИКА', 'label')).toBe(true)
  })

  it('пояснение (hint) ищется как часть названия', () => {
    const country = option('+7', '+7', 'Россия, Казахстан')
    expect(matchesSelectOption(country, 'казахстан', 'label')).toBe(true)
    expect(matchesSelectOption(country, 'россия', 'both')).toBe(true)
  })

  it('пустой запрос и режим off не сужают список', () => {
    expect(matchesSelectOption(genres[1], '', 'off')).toBe(true)
    expect(matchesSelectOption(genres[1], '', 'value')).toBe(true)
  })
})
