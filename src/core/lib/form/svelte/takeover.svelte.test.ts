// @vitest-environment happy-dom
// Перехват поля на уровне связки: живая ручка (FIELD_HANDLE на снимке),
// ошибка операции свойством f.error (pins + блокировка отправки),
// ожидание свойством f.pending. Callback у Field и замена вида —
// тесты кита полей (components/form/Field.takeover).
// Среда happy-dom нужна, чтобы svelte компилировал bind клиентски и
// $effect связки реально исполнялся.
import { tick } from 'svelte'
import { describe as suite, expect, test, vi } from 'vitest'
import { defineForm, field, v } from '../index.js'
import {
  bind, createConfig, FIELD_HANDLE,
  type BoundConfig, type BoundForm, type FieldComponent, type FieldHandle,
} from './index.js'
import type { Result } from '../result.js'
import type { Transport } from '../submit.js'

/** Корень эффектов: bind() регистрирует $effect и вне дерева компонентов не живёт. */
function withRoot<T>(fn: () => T): { value: T; dispose: () => void } {
  let value!: T
  const dispose = $effect.root(() => {
    value = fn()
  })
  return { value, dispose }
}

const Stub = (() => {}) as unknown as FieldComponent
const cfg: BoundConfig = createConfig({ resolve: () => Stub })

const desc = defineForm({
  id: 'takeover-demo',
  revision: 1,
  actions: [
    { id: 'submit', validate: 'full' },
    { id: 'draft', validate: 'partial', relax: ['required'] },
  ],
  fields: {
    doc: field.text({ label: 'Документ' }),
    note: field.text({ label: 'Заметка' }),
  },
})

const okTransport = (): { transport: Transport; spy: ReturnType<typeof vi.fn> } => {
  const spy = vi.fn(async (req: Parameters<Transport>[0]) => ({
    kind: 'result' as const,
    result: {
      v: 1, formId: desc.id, instance: req.envelope.instance,
      submissionId: req.envelope.submissionId, ok: true, status: 200,
      outcome: 'committed', errors: [], values: {}, revision: desc.revision, from: 'fetch',
    } satisfies Result,
  }))
  return { transport: spy as unknown as Transport, spy }
}

const handleOf = (bound: BoundForm, name: string): FieldHandle =>
  (bound.f[name] as unknown as Record<symbol, FieldHandle>)[FIELD_HANDLE]!

function submitWith(bound: BoundForm, intent: string, values: Record<string, string>) {
  const fd = new FormData()
  fd.set(bound.description.policy.envelopeKeys.intent, intent)
  for (const [k, val] of Object.entries(values)) fd.set(k, val)
  return bound.submit(fd)
}

suite('перехват поля: живая ручка', () => {
  test('чтение видит текущее состояние с обеих сторон; ручка одна на поле', () => {
    const { transport } = okTransport()
    const { value: bound, dispose } = withRoot(() => bind(cfg, desc, { transport }))
    const f = handleOf(bound, 'doc')
    expect(f.name).toBe('doc')
    f.onInput('черновик')
    expect(f.value).toBe('черновик')
    expect(bound.f.doc.value).toBe('черновик')
    bound.f.doc.onInput('снаружи')
    expect(f.value).toBe('снаружи')
    // идентичность стабильна: снимок новый — ручка та же
    expect(handleOf(bound, 'doc')).toBe(f)
    // писатели в снимок не протекают: у FieldView их нет ни в ключах, ни в спреде
    expect('error' in bound.f.doc).toBe(false)
    expect({ ...bound.f.doc }).not.toHaveProperty('pending')
    dispose()
  })
})

suite('перехват поля: f.error', () => {
  const setup = () => {
    const { transport, spy } = okTransport()
    const root = withRoot(() => bind(cfg, desc, { transport }))
    return { ...root, spy, f: handleOf(root.value, 'doc') }
  }

  test('ошибка видна у поля (external) и блокирует полную отправку; новое значение пропускает', async () => {
    const { value: bound, dispose, spy, f } = setup()
    f.error = { code: 'doc.unprepared' }
    expect(f.error).toEqual({ code: 'doc.unprepared' })
    expect(bound.f.doc.errors.map((e) => e.code)).toContain('doc.unprepared')
    expect(bound.f.doc.errors[0]?.origin).toBe('external')

    const blocked = await submitWith(bound, 'submit', { doc: '' })
    expect(spy).not.toHaveBeenCalled()
    expect(blocked?.ok).toBe(false)
    expect(blocked?.outcome).toBe('not-applied')
    // ошибка осталась на месте после заблокированной отправки
    expect(bound.f.doc.errors.map((e) => e.code)).toContain('doc.unprepared')

    // закреп за значением на момент ошибки: другое значение — отправка идёт
    const passed = await submitWith(bound, 'submit', { doc: 'готов' })
    expect(spy).toHaveBeenCalledTimes(1)
    expect(passed?.ok).toBe(true)
    dispose()
  })

  test('f.error = undefined снимает ошибку и блокировку', async () => {
    const { value: bound, dispose, spy, f } = setup()
    f.error = { code: 'doc.unprepared' }
    f.error = undefined
    expect(f.error).toBeUndefined()
    expect(bound.f.doc.errors).toEqual([])
    const r = await submitWith(bound, 'submit', { doc: '' })
    expect(spy).toHaveBeenCalledTimes(1)
    expect(r?.ok).toBe(true)
    dispose()
  })

  test('частичное действие ошибкой операции не блокируется (как локальная проверка)', async () => {
    const { value: bound, dispose, spy, f } = setup()
    f.error = { code: 'doc.unprepared' }
    const r = await submitWith(bound, 'draft', { doc: '' })
    expect(spy).toHaveBeenCalledTimes(1)
    expect(r?.ok).toBe(true)
    dispose()
  })

  test('собственная проверка сильнее: своя ошибка у поля первой, ошибка операции — последней', async () => {
    const strict = defineForm({
      id: 'takeover-strict',
      revision: 1,
      actions: [{ id: 'submit', validate: 'full' }],
      fields: { doc: field.text({ label: 'Документ', validate: [v.required()] }) },
    })
    const { transport, spy } = okTransport()
    const { value: bound, dispose } = withRoot(() => bind(cfg, strict, { transport }))
    handleOf(bound, 'doc').error = { code: 'doc.unprepared' }
    const blocked = await submitWith(bound, 'submit', { doc: '' })
    expect(spy).not.toHaveBeenCalled()
    expect(blocked?.ok).toBe(false)
    const errors = bound.f.doc.errors
    expect(errors.length).toBeGreaterThan(1)
    expect(errors[0]?.origin).toBe('core')
    expect(errors[errors.length - 1]?.code).toBe('doc.unprepared')
    dispose()
  })
})

suite('перехват поля: f.pending', () => {
  test('отправка ждёт подготовку; после готовности pending пуст', async () => {
    const { transport, spy } = okTransport()
    const { value: bound, dispose } = withRoot(() => bind(cfg, desc, { transport }))
    const f = handleOf(bound, 'doc')
    let release!: () => void
    f.pending = new Promise<void>((res) => { release = res })
    expect(f.pending).toBeInstanceOf(Promise)

    let settled = false
    const pending = submitWith(bound, 'submit', { doc: 'сырьё' }).then((r) => {
      settled = true
      return r
    })
    await tick()
    await Promise.resolve()
    expect(settled).toBe(false)
    expect(spy).not.toHaveBeenCalled()

    release()
    const r = await pending
    expect(r?.ok).toBe(true)
    expect(spy).toHaveBeenCalledTimes(1)
    await tick()
    expect(f.pending).toBeUndefined()
    dispose()
  })

  test('f.pending = undefined снимает ожидание', async () => {
    const { transport, spy } = okTransport()
    const { value: bound, dispose } = withRoot(() => bind(cfg, desc, { transport }))
    const f = handleOf(bound, 'doc')
    f.pending = new Promise<void>(() => {}) // никогда не завершается
    f.pending = undefined
    const r = await submitWith(bound, 'submit', { doc: 'x' })
    expect(spy).toHaveBeenCalledTimes(1)
    expect(r?.ok).toBe(true)
    dispose()
  })

  test('упавшая подготовка отправку не роняет (ошибку ставит сам перехватчик)', async () => {
    const { transport, spy } = okTransport()
    const { value: bound, dispose } = withRoot(() => bind(cfg, desc, { transport }))
    handleOf(bound, 'doc').pending = Promise.reject(new Error('подготовка упала'))
    const r = await submitWith(bound, 'submit', { doc: 'x' })
    expect(spy).toHaveBeenCalledTimes(1)
    expect(r?.ok).toBe(true)
    dispose()
  })
})
