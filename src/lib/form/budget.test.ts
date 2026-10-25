import { describe, expect, test } from 'vitest'
import { FILE_BUDGET_RESERVE, formLimits } from './budget.js'
import { FormDefinitionError, defineForm, field, v, validateForm } from './index.js'

const MB = 1024 * 1024

/** Файл нужного веса: содержимое не важно, считается только `size`. */
const file = (name: string, size: number, type = 'image/jpeg') =>
  new File([new Uint8Array(size)], name, { type })

const probe = (budget?: number, extra: Record<string, unknown> = {}) =>
  defineForm({
    id: 'probe',
    ...(budget === undefined ? {} : { limits: { budget } }),
    fields: {
      avatar: field.file({ label: 'Аватар', validate: [v.maxSize(10 * MB)] }),
      ...extra,
    },
  })

const codes = (errors: readonly { code: string }[]) => errors.map((e) => e.code)

describe('бюджет формы', () => {
  test('бюджет файлов = бюджет тела минус резерв на текст', () => {
    expect(formLimits(8 * MB, ['avatar'])).toEqual({ budget: 8 * MB, filesBytes: 7 * MB, fileFields: ['avatar'] })
    expect(FILE_BUDGET_RESERVE).toBe(MB)
  })

  test('не объявлен — суммарной проверки нет', () => {
    const l = formLimits(undefined, ['avatar'])
    expect(l.budget).toBeNull()
    expect(l.filesBytes).toBe(Infinity)
  })

  test('ноль или минус — отказ объявления', () => {
    expect(() => formLimits(0, [])).toThrow(/limits\.budget/)
  })

  test('описание отдаёт бюджет и порядок файловых полей', () => {
    expect(probe(8 * MB).limits).toEqual({ budget: 8 * MB, filesBytes: 7 * MB, fileFields: ['avatar'] })
  })
})

describe('v.maxSize и бюджет', () => {
  test('личный предел сужается бюджетом файлов', () => {
    const d = probe(8 * MB)
    expect(codes(validateForm(d, { avatar: file('ok.jpg', 7 * MB) }))).toEqual([])
    const bad = validateForm(d, { avatar: file('big.jpg', 7 * MB + 1) })
    expect(codes(bad)).toEqual(['maxSize'])
    expect(bad[0]!.params).toMatchObject({ bytes: 7 * MB, name: 'big.jpg' })
  })

  test('сумма по всем файлам: строка одна и от поля-владельца', () => {
    const d = probe(8 * MB, { docs: field.files({ label: 'Документы', validate: [v.maxSize(10 * MB)] }) })
    const errors = validateForm(d, { avatar: file('a.jpg', 4 * MB), docs: [file('b.pdf', 4 * MB, 'application/pdf')] })
    expect(codes(errors)).toEqual(['file.budget'])
    expect(errors[0]!.path).toBe('docs')
    expect(errors[0]!.params).toMatchObject({ name: 'b.pdf' })
  })

  test('без бюджета сумма не проверяется', () => {
    const d = probe(undefined, { docs: field.files({ label: 'Документы', validate: [v.maxSize(20 * MB)] }) })
    expect(codes(validateForm(d, { avatar: file('a.jpg', 9 * MB), docs: [file('b.pdf', 9 * MB)] }))).toEqual([])
  })

  test('файловое поле без maxSize: предупреждение без бюджета, ошибка с бюджетом', () => {
    const loose = defineForm({ id: 'loose', fields: { pic: field.file({ label: 'Файл' }) } })
    expect(loose.defects.map((x) => x.severity)).toEqual(['warn'])
    expect(() =>
      defineForm({ id: 'strict', limits: { budget: 8 * MB }, fields: { pic: field.file({ label: 'Файл' }) } }),
    ).toThrow(FormDefinitionError)
  })
})
