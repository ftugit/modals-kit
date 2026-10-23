// Защита схемы демо-панели: правила `demoPanelDefects`/`validateDemoPanel`.
// Это сборка, а не время работы: ошибка объявления обязана ронять dev, SSR и
// тесты — до того, как страницу увидит пользователь.
import { describe, expect, it } from 'vitest'
import { defineDemoPanel, demoPanelDefects, demoSelect, demoToggle, validateDemoPanel } from './define'

const good = () =>
  ({
    id: 'demo-x',
    action: '/x',
    fields: [
      demoSelect({
        key: 'mode',
        label: 'Режим',
        options: [
          { value: 'a', label: 'A' },
          { value: 'b', label: 'B' },
        ],
        defaultValue: 'a',
      }),
      demoToggle({ key: 'nav', label: 'Навигация', defaultValue: true }),
    ],
  }) as ReturnType<typeof defineDemoPanel<{ mode: string; nav: boolean }>>

/** Первое нарушение — короткой строкой, без полного баннера. */
const defect = (patch: (s: Record<string, unknown>) => void): string => {
  const s = good() as unknown as Record<string, unknown>
  patch(s)
  return demoPanelDefects(s)[0] ?? ''
}

describe('valid schema', () => {
  it('проходит проверку и не бросает', () => {
    expect(() => validateDemoPanel(good())).not.toThrow()
    expect(demoPanelDefects(good())).toEqual([])
  })

  it('defineDemoPanel возвращает ту же схему', () => {
    const s = good()
    expect(defineDemoPanel<{ mode: string; nav: boolean }>(s)).toBe(s)
  })
})

describe('падает на ошибках объявления', () => {
  it('пустой id', () => {
    expect(defect((s) => (s.id = ''))).toContain('id схемы пуст')
  })

  it('id с пробелом', () => {
    expect(defect((s) => (s.id = 'demo x'))).toContain('не годится в бронь')
  })

  it('action не путём от корня', () => {
    expect(defect((s) => (s.action = 'steps'))).toContain('должен быть путём от корня')
  })

  it('пустые fields', () => {
    expect(defect((s) => (s.fields = []))).toContain('fields пуст')
  })

  it('дубликат ключа', () => {
    expect(
      defect((s) => {
        s.fields = [
          { type: 'toggle', key: 'nav', label: 'A', defaultValue: true },
          { type: 'toggle', key: 'nav', label: 'B', defaultValue: false },
        ]
      }),
    ).toContain('ключ повторяется')
  })

  it('ключ не из латиницы', () => {
    expect(
      defect((s) => (s.fields = [{ type: 'toggle', key: 'ключ', label: 'A', defaultValue: true }])),
    ).toContain('ключ из латиницы')
  })

  it('пустая подпись', () => {
    expect(
      defect((s) => (s.fields = [{ type: 'toggle', key: 'nav', label: '  ', defaultValue: true }])),
    ).toContain('пустая подпись')
  })

  it('список без вариантов', () => {
    expect(
      defect(
        (s) =>
          (s.fields = [{ type: 'select', key: 'mode', label: 'M', defaultValue: 'a', options: [] }]),
      ),
    ).toContain('список без вариантов')
  })

  it('умолчание вне вариантов', () => {
    expect(
      defect(
        (s) =>
          (s.fields = [
            {
              type: 'select',
              key: 'mode',
              label: 'M',
              defaultValue: 'z',
              options: [{ value: 'a', label: 'A' }],
            },
          ]),
      ),
    ).toContain('умолчание «z» отсутствует в вариантах')
  })

  it('повтор варианта списка', () => {
    expect(
      defect(
        (s) =>
          (s.fields = [
            {
              type: 'select',
              key: 'mode',
              label: 'M',
              defaultValue: 'a',
              options: [
                { value: 'a', label: 'A' },
                { value: 'a', label: 'A2' },
              ],
            },
          ]),
      ),
    ).toContain('вариант «a» повторяется')
  })

  it('умолчание тумблера не boolean', () => {
    expect(
      defect((s) => (s.fields = [{ type: 'toggle', key: 'nav', label: 'N', defaultValue: 'on' }])),
    ).toContain('умолчание тумблера — boolean')
  })

  it('сценарное поле с url: false', () => {
    expect(
      defect(
        (s) =>
          (s.fields = [
            {
              type: 'select',
              key: 'mode',
              label: 'M',
              defaultValue: 'a',
              options: [{ value: 'a', label: 'A' }],
              resetsScenario: true,
              url: false,
            },
          ]),
      ),
    ).toContain('сценарное поле обязано писаться в адрес')
  })

  it('неизвестный вид поля', () => {
    expect(defect((s) => (s.fields = [{ type: 'range', key: 'nav', label: 'N' }]))).toContain(
      'неизвестный вид',
    )
  })

  it('toParams не функция', () => {
    expect(defect((s) => (s.toParams = 'x'))).toContain('toParams объявлен, но не функция')
  })

  it('перечисляет ВСЕ нарушения сразу, а не первое', () => {
    const s = good() as unknown as Record<string, unknown>
    s.id = ''
    s.action = 'x'
    const defects = demoPanelDefects(s)
    expect(defects.length).toBeGreaterThanOrEqual(2)
  })

  it('сообщение называет поле и путь к документу', () => {
    const s = good() as unknown as Record<string, unknown>
    s.fields = [{ type: 'toggle', key: 'nav', label: 'N', defaultValue: 'on' }]
    expect(() => validateDemoPanel(s)).toThrow(/поле «nav»/)
    expect(() => validateDemoPanel(s)).toThrow(/universal-demo-panel\.md/)
  })
})
