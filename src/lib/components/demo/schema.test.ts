// Механика универсальной демо-панели: чтение адреса, сборка адреса, сценарий.
// Это юнит-слой; поведение в DOM (форма, «Применить», тач) — в браузерном
// наборе test/browser/steps.mjs.
import { describe, expect, it } from 'vitest'
import { demoDefaults, demoForm, demoHref, demoParams, demoScenarioChange } from './schema'
import { defineDemoPanel } from './define'

interface Fix extends Record<string, string | boolean> {
  demo: string
  nav: boolean
  filled: boolean
}

const schema = defineDemoPanel<Fix>({
  id: 'steps-demo',
  action: '/steps',
  fields: [
    {
      type: 'select',
      key: 'demo',
      label: 'Режим демо',
      defaultValue: 'url',
      options: [
        { value: 'url', label: 'Адрес' },
        { value: 'local', label: 'Локально', jsOnly: true },
      ],
      url: { omitWhenDefault: true },
      resetsScenario: true,
    },
    { type: 'toggle', key: 'nav', label: 'Навигация', defaultValue: true, url: { omitWhenDefault: true } },
    { type: 'toggle', key: 'filled', label: 'Ссылками', defaultValue: true, url: { omitWhenDefault: true } },
  ],
})

const at = (path: string) => new URL(path, 'http://demo.invalid')

describe('demoParams: чтение значений из адреса', () => {
  it('пустой адрес даёт умолчания', () => {
    expect(demoParams(schema, at('/steps'))).toEqual({ demo: 'url', nav: true, filled: true })
  })

  it('режим читается, тумблер выключенный — по «false», включённый — по «true»', () => {
    expect(demoParams(schema, at('/steps?demo=local&nav=false&filled=false'))).toEqual({
      demo: 'local',
      nav: false,
      filled: false,
    })
    // hidden-пара + чекбокс: среди значений есть «true» (или нативное «on») — включён
    expect(demoParams(schema, at('/steps?nav=false&nav=true')).nav).toBe(true)
    expect(demoParams(schema, at('/steps?nav=false&nav=on')).nav).toBe(true)
  })

  it('неизвестный вариант падает к умолчанию', () => {
    expect(demoParams(schema, at('/steps?demo=zzz')).demo).toBe('url')
  })

  it('умолчания схемы совпадают с чтением пустого адреса', () => {
    expect(demoDefaults(schema)).toEqual(demoParams(schema, at('/steps')))
  })
})

describe('demoHref: запись значений в адрес', () => {
  it('умолчания не пишутся — адрес остаётся чистым', () => {
    expect(demoHref(schema, { demo: 'url', nav: true, filled: true }, at('/steps'))).toBe('/steps')
  })

  it('выключенный тумблер и неумолчальный режим пишутся', () => {
    expect(demoHref(schema, { demo: 'local', nav: false, filled: true }, at('/steps'))).toBe(
      '/steps?demo=local&nav=false',
    )
  })

  it('чужие ключи живут, пока сценарий не сменился', () => {
    expect(demoHref(schema, { demo: 'local', nav: true, filled: true }, at('/steps?ustep=confirm'))).toBe(
      '/steps?ustep=confirm&demo=local',
    )
  })

  it('смена сценария пересобирает адрес: чужие ключи снимаются', () => {
    expect(
      demoHref(schema, { demo: 'local', nav: false, filled: true }, at('/steps?ustep=confirm&hstep=extra'), {
        resetScenario: true,
      }),
    ).toBe('/steps?demo=local&nav=false')
  })

  it('значения не из адреса не появляются в адресе', () => {
    const local = defineDemoPanel<Fix>({
      ...schema,
      fields: schema.fields.map((f) =>
        f.type === 'divider' ? f : f.key === 'nav' ? { ...f, url: false as const } : f,
      ) as typeof schema.fields,
    })
    expect(demoHref(local, { demo: 'url', nav: false, filled: true }, at('/steps'))).toBe('/steps')
  })
})

describe('demoScenarioChange: кто начинает новый сценарий', () => {
  it('ловит смену режима и молчит на тумблерах', () => {
    expect(demoScenarioChange(schema, { demo: 'url', nav: true, filled: true }, { demo: 'local', nav: true, filled: true })?.key).toBe('demo')
    expect(demoScenarioChange(schema, { demo: 'url', nav: true, filled: true }, { demo: 'url', nav: false, filled: true })).toBeNull()
  })
})

describe('demoForm: описание формы из схемы', () => {
  it('одно на схему: id, действие формы, поля и варианты списка', () => {
    const desc = demoForm(schema)
    expect(demoForm(schema)).toBe(desc)
    expect(desc.id).toBe('steps-demo')
    expect(desc.fields.map((f) => f.name)).toEqual(['demo', 'nav', 'filled'])
    expect(desc.fields[0]!.options?.map((o) => o.value)).toEqual(['url', 'local'])
    expect(desc.actions?.[0]).toMatchObject({ id: 'apply', label: 'Применить', validate: 'none' })
  })
})
