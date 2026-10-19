// Панель пагинатора на универсальном `DemoPanel` (этап 2): имена полей —
// канонические ключи адреса, гаты и связки → `jsOnly`/`disabledWhen`, а
// мапперы «значения панели ↔ хранилище» держат типы домена. Поведение
// выключений в DOM — в браузерном наборе (regressions.mjs, capabilities.mjs).
import { describe, expect, it } from 'vitest'
import { paginatorPanel, GATE_LABEL } from './compile'
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

const build = (over = {}) =>
  paginatorPanel<Fix>({
    pageParam: 'page',
    action: '/paginator',
    pageSizes: [10, 20],
    fields: FIELDS,
    ...over,
  })

const specOf = (panel: ReturnType<typeof build>, key: string) => {
  const spec = panel.schema.fields.find((f) => f.type !== 'divider' && f.key === key)
  if (!spec || spec.type === 'divider') throw new Error(`нет поля ${key}`)
  return spec
}

describe('paginatorPanel: схема панели', () => {
  it('имена полей — канонические ключи адреса; размер идёт первым', () => {
    const panel = build()
    expect(panel.schema.fields.filter((f) => f.type !== 'divider').map((f) => f.key)).toEqual([
      'page.size',
      'page.layout',
      'page.cols',
      'page.mode',
      'page.srch',
    ])
    // Адрес пишет адаптер пагинатора: у всех полей панели его нет.
    for (const f of panel.schema.fields)
      if (f.type !== 'divider') expect(f.url, `${f.key}: url`).toBe(false)
    expect(panel.schema.action).toBe('/paginator')
  })

  it('без pageSizes поля размера нет', () => {
    const panel = build({ pageSizes: undefined })
    expect(panel.schema.fields.some((f) => f.type !== 'divider' && f.key === 'page.size')).toBe(false)
  })

  it('divider режет порядок, а без подписи не выводится', () => {
    const panel = build({
      fields: [...FIELDS.slice(0, 2), { type: 'divider' }, ...FIELDS.slice(3)] as SettingsField<Fix>[],
    })
    expect(panel.schema.fields.some((f) => f.type === 'divider')).toBe(false)
  })
})

describe('paginatorPanel: выключения', () => {
  it('недостающая возможность источника — причина из GATE_LABEL', () => {
    const panel = build({ gates: { nativeSearch: false } as never })
    expect(specOf(panel, 'page.srch').disabledWhen?.({ 'page.srch': true })).toBe(
      `источник не поддерживает ${GATE_LABEL.nativeSearch}`,
    )
    // без переданных gates всё открыто
    expect(specOf(build(), 'page.srch').disabledWhen?.({ 'page.srch': true })).toBeUndefined()
  })

  it('enabledBy: разрешённое значение свободно, прочие — причина', () => {
    const cols = specOf(build(), 'page.cols')
    expect(cols.disabledWhen?.({ 'page.layout': 'columns' })).toBeUndefined()
    expect(cols.disabledWhen?.({ 'page.layout': 'list' })).toBe(
      'доступно при «Раскладка» = «Колонки»',
    )
  })

  it('связка к полю вне панели игнорируется (поле свободно)', () => {
    const fields: SettingsField<Fix>[] = [
      { key: 'z', label: 'Z', type: 'select', options: [['a', 'A']], enabledBy: [{ field: 'x', equals: 'b' }] },
    ]
    const panel = build({ fields, pageSizes: undefined })
    expect(specOf(panel, 'page.z').disabledWhen?.({ 'page.z': 'a' })).toBeUndefined()
  })

  it('jsOnly доезжает до схемы флагом (shell сам скажет причину)', () => {
    expect(specOf(build(), 'page.mode').jsOnly).toBe(true)
  })
})

describe('paginatorPanel: мапперы', () => {
  it('toPatch: parse у select, boolean у тумблера, размер отдельно, пустое не трогаем', () => {
    const { extra, size } = build().toPatch({
      'page.size': '20',
      'page.layout': 'columns',
      'page.cols': '3',
      'page.srch': true,
      'page.mode': '',
    })
    expect(size).toBe(20)
    expect(extra).toEqual({ layout: 'columns', cols: 3, srch: true })
    expect('mode' in extra).toBe(false)
  })

  it('toPatch: отсутствующий ключ (выключенное поле) записи не рождает', () => {
    expect(build().toPatch({ 'page.srch': false }).extra).toEqual({ srch: false })
  })

  it('toPanel: доменные значения хранилища → значения панели', () => {
    const values = build().toPanel({ layout: 'list', cols: 2, srch: true }, 20)
    expect(values).toEqual({
      'page.size': '20',
      'page.layout': 'list',
      'page.cols': '2',
      'page.srch': true,
      'page.mode': '',
    })
  })
})
