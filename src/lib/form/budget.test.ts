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
      photo: field.file({ label: 'Аватар', validate: [v.maxSize(10 * MB)] }),
      ...extra,
    },
  })

const codes = (errors: readonly { code: string }[]) => errors.map((e) => e.code)

describe('бюджет формы', () => {
  test('бюджет файлов = бюджет тела минус резерв на текст', () => {
    expect(formLimits(8 * MB, ['photo'])).toEqual({ budget: 8 * MB, filesBytes: 7 * MB, fileFields: ['photo'] })
    expect(FILE_BUDGET_RESERVE).toBe(MB)
  })

  test('не объявлен — суммарной проверки нет', () => {
    const l = formLimits(undefined, ['photo'])
    expect(l.budget).toBeNull()
    expect(l.filesBytes).toBe(Infinity)
  })

  test('ноль или минус — отказ объявления', () => {
    expect(() => formLimits(0, [])).toThrow(/бюджет тела/)
  })

  test('описание отдаёт бюджет и порядок файловых полей', () => {
    expect(probe(8 * MB).limits).toEqual({ budget: 8 * MB, filesBytes: 7 * MB, fileFields: ['photo'] })
  })
})

describe('v.maxSize и бюджет', () => {
  test('личный предел сужается бюджетом файлов', () => {
    const d = probe(8 * MB)
    expect(codes(validateForm(d, { photo: file('ok.jpg', 7 * MB) }))).toEqual([])
    const bad = validateForm(d, { photo: file('big.jpg', 7 * MB + 1) })
    expect(codes(bad)).toEqual(['maxSize'])
    expect(bad[0]!.params).toMatchObject({ bytes: 7 * MB, name: 'big.jpg' })
  })

  test('сумма по всем файлам — общая ошибка формы, без пути', () => {
    const d = probe(8 * MB, { docs: field.file({ multiple: true, label: 'Документы', validate: [v.maxSize(10 * MB)] }) })
    const errors = validateForm(d, { photo: file('a.jpg', 4 * MB), docs: [file('b.pdf', 4 * MB, 'application/pdf')] })
    expect(codes(errors)).toEqual(['form.budget'])
    expect(errors[0]!.path).toBeUndefined()
    expect(errors[0]!.params).toMatchObject({ max: 8 * MB })
    expect(Number(errors[0]!.params!['total'])).toBeGreaterThan(8 * MB)
  })

  test('текст входит в вес: кириллица считается байтами UTF-8', () => {
    const d = probe(8 * MB, { note: field.text({ label: 'Заметка' }) })
    // 4,5 МиБ кириллицы = 4 718 592 байта, плюс файл 4 МиБ — вместе больше бюджета
    const note = 'ж'.repeat(4.5 * MB / 2)
    const errors = validateForm(d, { note, photo: file('a.jpg', 4 * MB) })
    expect(codes(errors)).toEqual(['form.budget'])
    expect(Number(errors[0]!.params!['text'])).toBe(4.5 * MB)
  })

  test('без файлов и с коротким текстом ошибки нет', () => {
    const d = probe(8 * MB, { note: field.text({ label: 'Заметка' }) })
    expect(codes(validateForm(d, { note: 'привет', photo: file('a.jpg', 7 * MB) }))).toEqual([])
  })

  test('без бюджета сумма не проверяется', () => {
    const d = probe(undefined, { docs: field.file({ multiple: true, label: 'Документы', validate: [v.maxSize(20 * MB)] }) })
    expect(codes(validateForm(d, { photo: file('a.jpg', 9 * MB), docs: [file('b.pdf', 9 * MB)] }))).toEqual([])
  })

  test('защитник сборки: файловое поле без maxSize не собирается', () => {
    // ошибка объявления, а не предупреждение: без предела файла форма может
    // уйти больше своего бюджета, и узнать об этом на боевом запросе поздно
    expect(() => defineForm({ id: 'loose', fields: { pic: field.file({ label: 'Файл' }) } }))
      .toThrow(FormDefinitionError)
    expect(() =>
      defineForm({ id: 'strict', limits: { budget: 8 * MB }, fields: { pic: field.file({ multiple: true, label: 'Файлы' }) } }),
    ).toThrow(/maxSize/)
  })

  test('потолок окружения урезает объявленный бюджет', () => {
    const d = probe(100 * MB)
    expect(d.limits).toMatchObject({ budget: 100 * MB, filesBytes: 99 * MB })

    // потолок 8 МБ: объявленные 100 МБ молча игнорируются
    const errors = validateForm(d, { photo: file('big.jpg', 8 * MB) }, { budget: 8 * MB })
    expect(codes(errors)).toEqual(['maxSize'])
    expect(errors[0]!.params).toMatchObject({ bytes: 7 * MB })

    // потолок без объявленного бюджета сам становится бюджетом формы
    const bare = defineForm({
      id: 'bare', fields: { photo: field.file({ label: 'Аватар', validate: [v.maxSize(10 * MB)] }) },
    })
    expect(codes(validateForm(bare, { photo: file('ok.jpg', 7 * MB) }, { budget: 8 * MB }))).toEqual([])
    expect(codes(validateForm(bare, { photo: file('big.jpg', 8 * MB) }, { budget: 8 * MB }))).toEqual(['maxSize'])
  })
})
