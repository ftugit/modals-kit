import { describe, expect, test } from 'vitest'
import {
  check, CheckRegistry, defineForm, FILE_BUDGET_RESERVE, field, FormDefinitionError,
  formLimits, issue, mergeChecks, v, validateForm,
  type FormError,
} from './index'
import { createFormHandler } from './server'
import { buildEnvelope } from './envelope'

const MB = 1024 * 1024
const file = (name: string, size: number, type = 'image/jpeg') =>
  new File([new Uint8Array(size)], name, { type })

const probe = (budget: number | undefined, extra: Record<string, ReturnType<typeof field.file>> = {}) =>
  defineForm({
    id: 'upload',
    ...(budget === undefined ? {} : { budget }),
    fields: {
      note: field.textarea({ label: 'Заметка' }),
      photo: field.file({ label: 'Снимок', validate: [v.accept(['image/*']), v.maxSize(10 * MB)] }),
      ...extra,
    },
  })

const codes = (errors: readonly FormError[]) => errors.map((e) => e.code)

describe('бюджет формы', () => {
  test('бюджет файлов = бюджет тела минус резерв на текст', () => {
    expect(FILE_BUDGET_RESERVE).toBe(MB)
    expect(formLimits(8 * MB, ['a', 'b'])).toEqual({ budget: 8 * MB, filesBytes: 7 * MB, fileFields: ['a', 'b'] })
    expect(formLimits(512 * 1024, ['a']).filesBytes).toBe(0)
  })

  test('не объявлен — суммарной проверки нет', () => {
    expect(probe(undefined).limits).toEqual({ budget: null, filesBytes: Infinity, fileFields: ['photo'] })
  })

  test('ноль или минус — отказ объявления (budget и limits)', () => {
    expect(() => probe(0)).toThrow(FormDefinitionError)
    expect(() => probe(-1)).toThrow(FormDefinitionError)
    expect(() => defineForm({ id: 'bad', limits: { maxKeys: 0 }, fields: { a: field.text() } })).toThrow(FormDefinitionError)
    expect(() => defineForm({ id: 'bad', limits: { maxValuesPerKey: -2 }, fields: { a: field.text() } })).toThrow(FormDefinitionError)
    expect(() => defineForm({ id: 'bad', limits: { timeoutMs: Number.NaN }, fields: { a: field.text() } })).toThrow(FormDefinitionError)
  })

  test('описание отдаёт бюджет, изоморфные limits и порядок файловых полей', () => {
    const d = defineForm({
      id: 'intake-probe',
      budget: 8 * MB,
      limits: { maxKeys: 32, maxValuesPerKey: 8, timeoutMs: 25_000 },
      invalidFrom: 'shown',
      fields: { photo: field.file({ label: 'Снимок' }) },
    })
    expect(d.limits).toEqual({ budget: 8 * MB, filesBytes: 7 * MB, fileFields: ['photo'] })
    expect(d.intake).toEqual({ maxKeys: 32, maxValuesPerKey: 8, timeoutMs: 25_000 })
    expect(d.invalidFrom).toBe('shown')
  })
})

describe('v.maxSize и бюджет', () => {
  test('личный предел — только объявленное число, бюджет его не сужает', () => {
    // бюджет 8 МБ, личный предел 10 МБ: валидатор судит ровно десять
    const d = probe(8 * MB)
    expect(codes(validateForm(d, { photo: file('ok.jpg', 9 * MB) }))).toEqual(['form.budget'])
    const bad = validateForm(d, { photo: file('big.jpg', 10 * MB + 1) })
    expect(codes(bad)).toEqual(['maxSize'])
    expect(bad[0]!.params).toMatchObject({ bytes: 10 * MB })
  })

  test('сумма по всем файлам — общая ошибка формы, без пути', () => {
    const d = probe(8 * MB, { docs: field.file({ multiple: true, label: 'Файлы', validate: [v.maxSize(5 * MB)] }) })
    const errors = validateForm(d, { photo: file('a.jpg', 4 * MB), docs: [file('b.pdf', 3 * MB), file('c.pdf', 2 * MB)] })
    expect(codes(errors)).toEqual(['form.budget'])
    expect(errors[0]!.path).toBeUndefined()
    expect(errors[0]!.params).toMatchObject({ max: 8 * MB })
  })

  test('текст входит в вес: кириллица считается байтами UTF-8', () => {
    // 4 МБ файла + 4.5 МБ кириллицы > 8 МБ, хотя одних символов всего 2.25 млн
    const d = probe(8 * MB)
    const note = 'ж'.repeat(4.5 * MB / 2)
    const errors = validateForm(d, { note, photo: file('a.jpg', 4 * MB) })
    expect(codes(errors)).toEqual(['form.budget'])
    expect(Number(errors[0]!.params!['text'])).toBe(4.5 * MB)
  })

  test('без файлов и с коротким текстом ошибки нет', () => {
    const d = probe(8 * MB)
    expect(validateForm(d, { note: 'коротко', photo: file('a.jpg', 6 * MB) })).toEqual([])
  })

  test('без бюджета сумма не проверяется', () => {
    const d = probe(undefined)
    expect(validateForm(d, { photo: file('a.jpg', 9 * MB) })).toEqual([])
  })

  test('файловое поле без maxSize собирается: предел даёт только бюджет тела', () => {
    const open = defineForm({ id: 'open', fields: { docs: field.file({ multiple: true, label: 'Файлы' }) } })
    expect(open.limits.budget).toBeNull()
    expect(validateForm(open, { docs: [file('a.pdf', 20 * MB)] })).toEqual([])

    const capped = defineForm({
      id: 'capped',
      budget: 8 * MB,
      fields: { docs: field.file({ multiple: true, label: 'Файлы' }) },
    })
    expect(validateForm(capped, { docs: [file('a.pdf', 3 * MB), file('b.pdf', 3 * MB)] })).toEqual([])
    expect(codes(validateForm(capped, { docs: [file('a.pdf', 5 * MB), file('b.pdf', 5 * MB)] })))
      .toEqual(['form.budget'])
  })

  test('потолок окружения урезает объявленный бюджет и уважает limits/checks из defineForm', async () => {
    const baseChecks = new CheckRegistry().register('free', async (val) => val === 'taken' ? issue('unique') : null)
    const overrideChecks = new CheckRegistry().register('free', async (val) => val === 'override-taken' ? issue('unique') : null)
    expect(mergeChecks(baseChecks, undefined)).toBe(baseChecks)
    const merged = mergeChecks(baseChecks, overrideChecks)!
    const dummyCtx = { path: 'slug', values: {}, signal: new AbortController().signal }
    expect(await merged.get('free')!('taken', dummyCtx)).toBeNull()
    expect(await merged.get('free')!('override-taken', dummyCtx)).toMatchObject({ code: 'unique' })

    const d = defineForm({
      id: 'upload-checks',
      budget: 100 * MB,
      limits: { maxKeys: 7 },
      checks: baseChecks,
      fields: {
        slug: field.text({ validate: [check('free')] }),
        extra: field.text(),
        photo: field.file({ validate: [v.maxSize(10 * MB)] }),
      },
    })
    expect(d.limits).toMatchObject({ budget: 100 * MB, filesBytes: 99 * MB })

    // потолок 8 МБ: объявленные 100 МБ молча игнорируются, вес держит потолок
    expect(codes(validateForm(d, { photo: file('a.jpg', 9 * MB) }, { budget: 8 * MB }))).toEqual(['form.budget'])
    expect(validateForm(d, { photo: file('a.jpg', 6 * MB) }, { budget: 8 * MB })).toEqual([])

    // тот же потолок — на сервере: min(100 МБ, 8 МБ) = 8 МБ + checks и limits.maxKeys из defineForm
    const handler = createFormHandler({
      description: d,
      limits: { budget: 8 * MB },
      execute: (c) => { c.commit(); return {} },
    })
    const send = (values: Record<string, File | string>) => {
      const fd = new FormData()
      for (const [k, val] of Object.entries(buildEnvelope({ formId: d.id, revision: d.revision, instance: 'upload-checks:new', submissionId: crypto.randomUUID() }, d.policy)))
        fd.set(k, val)
      fd.set(d.policy.envelopeKeys.intent, 'submit')
      for (const [k, val] of Object.entries(values)) fd.set(k, val)
      return handler(new Request('https://x.test/f', { method: 'POST', body: fd }))
    }
    expect((await send({ slug: 'ok', photo: file('a.jpg', 6 * MB) })).result).toMatchObject({ ok: true, errors: [] })
    expect((await send({ slug: 'taken', photo: file('a.jpg', 1 * MB) })).result.errors[0]?.code).toBe('unique')
    expect((await send({ slug: 'ok', extra: '8th-key', photo: file('a.jpg', 1 * MB) })).result.errors[0]?.code).toBe('body.too-many-keys')
    expect((await send({ slug: 'ok', photo: file('a.jpg', 9 * MB) })).status).toBe(413)
  })
})
