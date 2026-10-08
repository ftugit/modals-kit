// Компилятор демо-панели: форма описания, группы вывода, инверсия связок,
// маппер патча и seed. Это юнит-слой этапа 6; поведение выключений в DOM —
// в браузерном наборе (regressions.mjs).
import { describe, expect, it } from 'vitest'
import { compileDemoPanelSchema, GATE_LABEL } from './compile'
import type { SettingsField } from './types'

interface Fix extends Record<string, string | number | boolean> {
  layout: 'list' | 'columns'
  cols: 'auto' | number
  srch: boolean
  mode: 'accumulate' | 'single'
  x: string
  z: string
}

const FIELDS: readonly SettingsField<Fix>[] = [
  {
    key: 'layout',
    label: 'Раскладка',
    type: 'select',
    options: [
      ['list', 'Список'],
      ['columns', 'Колонки'],
    ],
  },
  {
    key: 'cols',
    label: 'Колонки',
    type: 'select',
    parse: (raw) => (raw === 'auto' ? 'auto' : Number(raw)),
    options: [
      ['auto', 'Авто'],
      ['2', '2'],
      ['3', '3'],
    ],
    enabledBy: [{ field: 'layout', equals: 'columns' }],
  },
  { type: 'divider', label: 'Режим' },
  {
    key: 'mode',
    label: 'Режим',
    type: 'select',
    jsOnly: true,
    options: [
      ['accumulate', 'Накопление'],
      ['single', 'Классика'],
    ],
  },
  { key: 'srch', label: 'Поиск', type: 'toggle', requires: 'nativeSearch' },
]

const compile = (over = {}) =>
  compileDemoPanelSchema<Fix>({
    pageParam: 'page',
    pageSizes: [10, 20],
    fields: FIELDS,
    ...over,
  })

describe('compileDemoPanelSchema: описание формы', () => {
  it('fields = size + объявленные, имена — канонические ключи адреса', () => {
    const { definition } = compile()
    const byName = Object.fromEntries(definition.fields.map((f) => [f.name, f]))
    expect(definition.fields.map((f) => f.name)).toEqual([
      'page.size', 'page.layout', 'page.cols', 'page.mode', 'page.srch',
    ])
    const size = byName['page.size'] as { kind: string; options?: { value: string }[] }
    expect(size.kind).toBe('select')
    expect(size.options?.map((o) => o.value)).toEqual(['10', '20'])
    const srch = byName['page.srch'] as { kind: string; input: string }
    expect(srch.kind).toBe('checkbox')
    expect(srch.input).toBe('checkbox')
  })
})

describe('compileDemoPanelSchema: groups', () => {
  it('divider режет порядок; size и headless-поле — в нулевой группе', () => {
    const { groups } = compile()
    expect(groups).toEqual([
      { label: undefined, items: ['page.size', 'page.layout', 'page.cols'] },
      { label: 'Режим', items: ['page.mode', 'page.srch'] },
    ])
  })
})

describe('compileDemoPanelSchema: инверсия enabledBy', () => {
  it('«cols доступно при layout=columns» → правило «layout=list гасит cols»', () => {
    const { links } = compile()
    expect(links).toHaveLength(1)
    expect(links[0].when).toEqual([{ field: 'page.layout', value: 'list' }])
    expect(links[0].effect).toEqual({ kind: 'disable-field', field: 'page.cols' })
    expect(links[0].reason).toContain('«Раскладка»')
    expect(links[0].reason).toBe('доступно при «Раскладка» = «Колонки»') // текст о РАЗРЕШЁННОМ значении
  })
  it('несколько «других» значений → по правилу на каждое; in снимает часть', () => {
    const fields: readonly SettingsField<Fix>[] = [
      { key: 'layout', label: 'L', type: 'select', options: [['list', 'L'], ['columns', 'C']] },
      {
        key: 'z',
        label: 'Z',
        type: 'select',
        options: [['a', 'A'], ['b', 'B'], ['c', 'C']],
        enabledBy: [{ field: 'layout', in: ['columns'] }],
      },
    ]
    const { links } = compileDemoPanelSchema<Fix>({ pageParam: 'p', pageSizes: [10], fields })
    expect(links.map((l) => l.when[0]!.value)).toEqual(['list']) // 'columns' разрешён — не гасит
  })
  it('правило к зависимости-переключателю строится по булевым значениям', () => {
    const fields: readonly SettingsField<Fix>[] = [
      { key: 'srch', label: 'Поиск', type: 'toggle' },
      { key: 'x', label: 'X', type: 'select', options: [['1', '1']], enabledBy: [{ field: 'srch', equals: true }] },
    ]
    const { links } = compileDemoPanelSchema<Fix>({ pageParam: 'p', pageSizes: [10], fields })
    expect(links).toHaveLength(1)
    expect(links[0].when).toEqual([{ field: 'p.srch', value: 'false' }])
  })
  it('связка к полю вне панели игнорируется (поле свободно)', () => {
    const fields: readonly SettingsField<Fix>[] = [
      { key: 'x', label: 'X', type: 'select', options: [['1', '1']], enabledBy: [{ field: 'ghost', equals: 'y' }] },
    ]
    const { links } = compileDemoPanelSchema<Fix>({ pageParam: 'p', pageSizes: [10], fields })
    expect(links).toHaveLength(0)
  })
})

describe('compileDemoPanelSchema: gates и jsOnly', () => {
  it('недостающая возможность — статическое выключение с причиной', () => {
    const { gated } = compile({ gates: { nativeSearch: false } as never })
    expect(gated.get('page.srch')).toBe(`источник не поддерживает ${GATE_LABEL.nativeSearch}`)
    expect(gated.has('page.cols')).toBe(false)
  })
  it('без переданных gates всё открыто', () => {
    expect(compile().gated.size).toBe(0)
  })
  it('jsOnly — имена, собранные для shell', () => {
    expect([...compile().jsOnly]).toEqual(['page.mode'])
  })
})

describe('compileDemoPanelSchema: маппер патча и seed', () => {
  it('select через parse, toggle — boolean, size — отдельно; пустое не трогаем', () => {
    const { toPatch } = compile()
    expect(toPatch({ 'page.layout': 'columns', 'page.cols': 'auto', 'page.srch': true, 'page.mode': '' })).toEqual({
      extra: { layout: 'columns', cols: 'auto', srch: true },
    })
    expect(toPatch({ 'page.cols': '3' }).extra.cols).toBe(3)
    expect(toPatch({ 'page.size': '20' })).toEqual({ extra: {}, pageSize: 20 })
    expect(toPatch({ 'page.size': 'x' })).toEqual({ extra: {} })
  })
  it('отсутствующий ключ (disabled-скип) не рождает запись', () => {
    const { toPatch } = compile()
    expect(Object.keys(toPatch({ 'page.layout': 'list' }).extra)).toEqual(['layout'])
  })
  it('seed: доменные значения зеркала; toggle — boolean', () => {
    const { toSeed } = compile()
    expect(
      toSeed({ layout: 'list', cols: 3, srch: false, mode: 'accumulate' }, 20),
    ).toEqual({ 'page.size': '20', 'page.layout': 'list', 'page.cols': '3', 'page.srch': false, 'page.mode': 'accumulate' })
    expect(toSeed({ srch: true }, 10)['page.srch']).toBe(true)
    expect(toSeed({}, 10)['page.layout']).toBe('')
  })
})
