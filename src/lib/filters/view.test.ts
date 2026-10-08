/**
 * Api схемы глазами интерфейса: что компонент получает готовым.
 *
 * Проверяется то, ради чего этот слой существует: контролы выводятся из
 * ОБЪЯВЛЕНИЯ схемы (лишнего не появится, пропущенного не будет), связки гасят
 * поля с причиной, патч хранилища снимает опустевшие ключи, не трогает
 * необъявленные и НЕ ПИШЕТ значение, снятое связкой (JS решает то же, что
 * делает браузер без JS, не отправляя выключенный контрол), а чипы несут
 * адрес, снимающий ровно одно значение.
 */
import { describe, expect, it } from 'vitest'
import {
  catalogFilterControls,
  catalogFilterExtraPatch,
  catalogFilterFieldStates,
  catalogFilterRemoveValuePatch,
  catalogFilterView,
} from './view'
import type { CatalogFilterSchema } from './catalog-filter'

const schema: CatalogFilterSchema = {
  source: 'shikimori',
  version: 1,
  builtAt: '2026-10-07T10:00:00.000Z',
  fields: [
    {
      key: 'genres',
      label: 'Жанры',
      type: 'multiselect',
      modes: ['and', 'not'],
      options: [
        { value: '1', label: 'Экшен' },
        { value: '2', label: 'Драма' },
      ],
    },
    { key: 'studios', label: 'Студии', type: 'multiselect', modes: ['and'], optionsTruncated: 5, options: [{ value: '858', label: 'Wit Studio' }] },
    {
      key: 'kind',
      label: 'Тип',
      type: 'select',
      options: [
        { value: 'tv', label: 'ТВ' },
        { value: 'movie', label: 'Фильм' },
      ],
    },
    {
      key: 'status',
      label: 'Статус',
      type: 'select',
      options: [
        { value: 'latest', label: 'последние' },
        { value: 'anons', label: 'анонс' },
      ],
    },
    { key: 'score', label: 'Оценка', type: 'number', bounds: ['min'], min: 1, max: 10 },
    { key: 'year', label: 'Год', type: 'number', min: 1900, max: 2028 },
  ],
  rules: [
    { id: 'search-with-latest', when: [{ field: 'status', value: 'latest' }], drop: 'q', reason: 'поиск не работает' },
    { id: 'score-with-anons', when: [{ field: 'status', value: 'anons' }], drop: { field: 'score' }, reason: 'у анонсов нет оценки' },
  ],
}

describe('контролы из объявления схемы', () => {
  it('по одному на объявленный путь, с подписью режима/границы', () => {
    const controls = catalogFilterControls(schema, {})
    expect(controls.map((control) => control.path)).toEqual([
      'filters.genres.and',
      'filters.genres.not',
      'filters.studios.and',
      'filters.kind',
      'filters.status',
      'filters.score.min',
      'filters.year.min',
      'filters.year.max',
    ])
    expect(controls.map((control) => control.name)).toEqual([
      'page.filters.genres.and',
      'page.filters.genres.not',
      'page.filters.studios.and',
      'page.filters.kind',
      'page.filters.status',
      'page.filters.score.min',
      'page.filters.year.min',
      'page.filters.year.max',
    ])
    expect(controls[0].label).toBe('Жанры · все из')
    expect(controls[1].label).toBe('Жанры · кроме')
    expect(controls[5].label).toBe('Оценка · от')
    // Режима «или» в схеме нет — контрола тоже: источник его не поддерживает.
    expect(controls.some((control) => control.path === 'filters.genres.or')).toBe(false)
  })

  it('значения контролов — из extra, а не из адреса', () => {
    const controls = catalogFilterControls(schema, {
      'filters.genres.and': '1,2',
      'filters.kind': 'tv',
      'filters.score.min': 7,
    })
    expect(controls.find((control) => control.path === 'filters.genres.and')?.value).toEqual(['1', '2'])
    expect(controls.find((control) => control.path === 'filters.kind')?.value).toBe('tv')
    // Числовая граница едет числом, а инпут показывает её строкой.
    expect(controls.find((control) => control.path === 'filters.score.min')?.value).toBe('7')
  })

  it('границы числового инпута — из схемы, край базы показан ПОДСКАЗКОЙ, а не значением', () => {
    const controls = catalogFilterControls(schema, {})
    const score = controls.find((control) => control.path === 'filters.score.min')
    const yearMax = controls.find((control) => control.path === 'filters.year.max')
    // Значение пустое: предзаполненный край уехал бы в адрес при нативной
    // отправке формы и висел бы фильтром, которого пользователь не выбирал.
    expect(score).toMatchObject({ kind: 'number', value: '', placeholder: '1', min: 1, max: 10 })
    expect(yearMax).toMatchObject({ kind: 'number', value: '', placeholder: '2028', min: 1900, max: 2028 })
    // А если значение пришло из extra — оно показывается, подсказка не мешает.
    const filled = catalogFilterControls(schema, { 'filters.score.min': '7' }).find(
      (control) => control.path === 'filters.score.min',
    )
    expect(filled).toMatchObject({ value: '7', placeholder: '1' })
  })

  it('обрезанный лимитом список показывает, сколько скрыто', () => {
    const studios = catalogFilterControls(schema, {}).find((control) => control.path === 'filters.studios.and')
    expect(studios?.kind === 'multiselect' && studios.truncated).toBe(5)
  })
})

describe('связки в интерфейсе', () => {
  it('поле под связкой гасится с причиной, называющей виновника', () => {
    const states = catalogFilterFieldStates(schema, { 'filters.status': 'anons' })
    const score = states.find((state) => state.key === 'score')
    // Причина — не «список невозможного», а ответ «что мешает этому полю»:
    // связка названа полем-виновником, объяснение берётся из схемы.
    expect(score).toMatchObject({
      disabled: true,
      suppressedBy: 'score-with-anons',
      reason: '«Статус» блокирует поле: у анонсов нет оценки',
    })
    // Соседние поля связка не трогает.
    expect(states.find((state) => state.key === 'genres')?.disabled).toBe(false)
  })

  it('несколько условий связки называются все (согласование по числу)', () => {
    const multi = {
      ...schema,
      rules: [
        {
          id: 'kind-and-status',
          when: [
            { field: 'kind', value: 'movie' },
            { field: 'status', value: 'anons' },
          ],
          drop: { field: 'score' },
          reason: 'связка с двумя условиями',
        },
      ],
    }
    const score = catalogFilterFieldStates(multi, {
      'filters.kind': 'movie',
      'filters.status': 'anons',
    }).find((state) => state.key === 'score')
    expect(score?.reason).toBe('«Тип» и «Статус» блокируют поле: связка с двумя условиями')
  })

  it('запрет поиска виден отдельно — у поиска свой канал', () => {
    const view = catalogFilterView(schema, { 'filters.status': 'latest' })
    expect(view.searchBlocked).toEqual({ id: 'search-with-latest', reason: 'поиск не работает' })
    expect(view.suppressed).toEqual([])
  })

  it('снятое связкой поле названо в картине панели', () => {
    const view = catalogFilterView(schema, { 'filters.status': 'anons' })
    expect(view.suppressed).toEqual([
      { key: 'score', label: 'Оценка', reason: '«Статус» блокирует поле: у анонсов нет оценки' },
    ])
    expect(view.controls.find((control) => control.path === 'filters.score.min')).toMatchObject({
      disabled: true,
      reason: '«Статус» блокирует поле: у анонсов нет оценки',
    })
    // Объяснение блока остаётся в картине даже до выбора оценки: оно нужно
    // пользователю без JS и доступно у формы до её раскрытия.
    expect(view.violations.map((violation) => violation.id)).toEqual(['score-with-anons'])
  })

  it('no-JS view retains a blocked value and its source-owned explanation', () => {
    const view = catalogFilterView(schema, { 'filters.status': 'anons', 'filters.score.min': '5' })
    expect(view.violations).toHaveLength(1)
    expect(view.violations[0]).toMatchObject({
      id: 'score-with-anons',
      drop: { field: 'score' },
      message: 'у анонсов нет оценки',
    })
    expect(view.chips.some((chip) => chip.key === 'score' && chip.value === '5')).toBe(true)
  })

  it('противоречие режимов одного поля — подсказка, а не запрет', () => {
    const view = catalogFilterView(schema, { 'filters.genres.and': '1', 'filters.genres.not': '1' })
    expect(view.violations.map((violation) => violation.id)).toEqual(['contradictory-modes'])
    // Оба контрола остаются рабочими: источник честно вернёт пустую выдачу.
    expect(view.controls.filter((control) => control.disabled)).toEqual([])
  })
})

describe('патч хранилища', () => {
  it('пустое значение снимает ключ, список едет строкой через запятую', () => {
    const patch = catalogFilterExtraPatch(schema, {
      'filters.genres.and': ['1', '2'],
      'filters.kind': 'tv',
      'filters.status': '',
    })
    expect(patch['filters.genres.and']).toBe('1,2')
    expect(patch['filters.kind']).toBe('tv')
    expect(patch['filters.status']).toBeUndefined()
    // Объявленные, но не упомянутые ключи тоже очищаются: патч — полный набор.
    expect(Object.keys(patch).sort()).toEqual([
      'filters.genres.and',
      'filters.genres.not',
      'filters.kind',
      'filters.score.min',
      'filters.status',
      'filters.studios.and',
      'filters.year.max',
      'filters.year.min',
    ])
  })

  it('граница числового поля остаётся ЧИСЛОМ, равная краю базы — не значение', () => {
    const patch = catalogFilterExtraPatch(schema, {
      'filters.score.min': '7',
      'filters.year.min': '1900',
      'filters.year.max': '2028',
    })
    expect(patch['filters.score.min']).toBe(7)
    expect(patch['filters.year.min']).toBeUndefined()
    expect(patch['filters.year.max']).toBeUndefined()
  })

  it('значение, снятое связкой, в патч не едет — но причина остаётся в картине', () => {
    // Анонсы + оценка: поле гасит связка схемы, и патч (одна запись в
    // хранилище) снимает оценку сам — как это делает браузер без JS, не
    // отправляя выключенный контрол. Итог у JS и no-JS одинаков: источника
    // оценка не касается.
    const patch = catalogFilterExtraPatch(schema, { 'filters.status': 'anons', 'filters.score.min': '5' })
    expect(patch['filters.status']).toBe('anons')
    expect(patch['filters.score.min']).toBeUndefined()
    // Соседние значения поля-связки живут: патч чистит весь ключ «score», а не
    // всё, что рядом.
    expect(patch['filters.kind']).toBeUndefined()
    // Та же связка без триггера ничего не трогает: значение остаётся значением.
    const kept = catalogFilterExtraPatch(schema, { 'filters.status': 'released', 'filters.score.min': '5' })
    expect(kept['filters.score.min']).toBe(5)
  })

  it('необъявленный ключ в патч не попадает', () => {
    const patch = catalogFilterExtraPatch(schema, { 'filters.ghost': 'x', 'filters.kind': 'tv' })
    expect('filters.ghost' in patch).toBe(false)
  })

  it('снятие одного значения оставляет соседей и режимы поля', () => {
    const extra = { 'filters.genres.and': '1,2', 'filters.genres.not': '2', 'filters.kind': 'tv' }
    const patch = catalogFilterRemoveValuePatch(schema, extra, 'filters.genres.and', '1')
    expect(patch['filters.genres.and']).toBe('2')
    expect(patch['filters.genres.not']).toBe('2')
    expect(patch['filters.kind']).toBe('tv')
  })

  it('снятие последнего значения поля очищает ключ полностью', () => {
    const patch = catalogFilterRemoveValuePatch(schema, { 'filters.kind': 'tv' }, 'filters.kind', 'tv')
    expect(patch['filters.kind']).toBeUndefined()
  })
})

describe('адреса, которые получает компонент', () => {
  it('чипы несут адрес, снимающий ровно одно значение', () => {
    const view = catalogFilterView(
      schema,
      { 'filters.genres.and': '1,2', 'filters.kind': 'tv' },
      { url: { page: '/paginator', prefix: 'page', preserved: { 'page.size': '5' } } },
    )
    const chip = view.chips.find((item) => item.path === 'filters.genres.and' && item.value === '1')
    expect(chip?.href).toContain('page.filters.genres.and=2')
    expect(chip?.href).not.toContain('=1')
    expect(chip?.href).toContain('page.size=5')
    expect(chip?.label).toBe('Экшен')
    expect(chip?.fieldLabel).toBe('Жанры')
  })

  it('форма получает action без своих фильтров и скрытые чужие ключи', () => {
    const view = catalogFilterView(schema, { 'filters.kind': 'tv' }, {
      url: {
        page: '/paginator',
        preserved: { 'page.size': '5', 'page.filters.kind': 'tv', 'gallery.q': 'кот' },
      },
    })
    // `action` — с сохранёнными ключами каталога, но БЕЗ своих фильтров и без
    // указателя страницы: новый набор начинается с первой.
    expect(view.formAction).toBe('/paginator?gallery.q=%D0%BA%D0%BE%D1%82&page.size=5')
    expect(view.hidden).toEqual([
      { name: 'page.size', value: '5' },
      { name: 'gallery.q', value: 'кот' },
    ])
  })

  it('счётчик считает значения, а не поля', () => {
    const count = (extra: Record<string, string>) =>
      catalogFilterView(schema, extra, { url: { page: '/paginator', prefix: 'page', preserved: {} } }).count
    expect(count({ 'filters.genres.and': '1,2', 'filters.kind': 'tv' })).toBe(3)
    expect(count({})).toBe(0)
  })
})
