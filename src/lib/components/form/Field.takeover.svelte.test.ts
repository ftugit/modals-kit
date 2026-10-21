// @vitest-environment happy-dom
// Field takeover: callback после оживления, замена вида со сверкой базы,
// приоритет instead, f.pending с перечиткой DOM на настоящей форме.
// Ручка/ошибка/блокировка на уровне связки — form/svelte/takeover.test.
import { mount, tick, unmount, type Component } from 'svelte'
import { describe as suite, expect, test, vi } from 'vitest'
import { defineForm, field } from '#lib/form/index.js'
import {
  bind, createConfig,
  type BoundConfig, type FieldComponent, type FieldTakeover, type FieldView,
} from '#lib/form/svelte/index.js'
import type { Result } from '#lib/form/result.js'
import type { Transport } from '#lib/form/submit.js'
import { fieldViews } from './resolve'
import CopyField from './CopyField.svelte'
import TakeoverForm from './TakeoverForm.test.svelte'
import TakeoverView from './TakeoverView.test.svelte'

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
  id: 'field-takeover-demo',
  revision: 1,
  actions: [{ id: 'submit', validate: 'full' }],
  fields: {
    doc: field.text({ label: 'Документ' }),
    note: field.text({ label: 'Заметка' }),
  },
})

function setup(o: { takeover?: FieldTakeover; instead?: Component<FieldView> } = {}) {
  const spy = vi.fn(async (req: Parameters<Transport>[0]) => ({
    kind: 'result' as const,
    result: {
      v: 1, formId: desc.id, instance: req.envelope.instance,
      submissionId: req.envelope.submissionId, ok: true, status: 200,
      outcome: 'committed', errors: [], values: {}, revision: desc.revision, from: 'fetch',
    } satisfies Result,
  }))
  const root = withRoot(() => bind(cfg, desc, { transport: spy as unknown as Transport }))
  const target = document.createElement('div')
  document.body.append(target)
  const comp = mount(TakeoverForm, { target, props: { bound: root.value, ...o } })
  return {
    bound: root.value,
    target,
    spy,
    async cleanup() {
      await unmount(comp)
      root.dispose()
      target.remove()
    },
  }
}

const settle = async () => {
  await tick()
  await tick()
}

suite('Field takeover: жизненный цикл callback', () => {
  test('callback зовётся один раз после оживления; dispose — при размонтировании', async () => {
    const disposeSpy = vi.fn()
    const cb = vi.fn<FieldTakeover>(() => ({ dispose: disposeSpy }))
    const { bound, cleanup } = setup({ takeover: cb })
    await settle()
    expect(cb).toHaveBeenCalledTimes(1)
    expect(cb.mock.calls[0]![0].name).toBe('doc')
    // перерисовки от состояния формы перехват не пересоздают
    bound.f.doc.onInput('x')
    await settle()
    expect(cb).toHaveBeenCalledTimes(1)
    await cleanup()
    expect(disposeSpy).toHaveBeenCalledTimes(1)
  })

  test('упавший callback форму не роняет: поле штатное', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { target, cleanup } = setup({
      takeover: () => {
        throw new Error('перехватчик упал')
      },
    })
    await settle()
    expect(target.querySelector('[data-taken]')).toBeNull()
    expect(target.querySelector('input[name="doc"]')).not.toBeNull()
    await cleanup()
    errSpy.mockRestore()
  })
})

suite('Field takeover: замена вида', () => {
  test('base совпал — компонент перехватчика; ручка в нём живая в обе стороны', async () => {
    const { bound, target, cleanup } = setup({
      takeover: (f) => ({ view: TakeoverView, base: fieldViews.resolveView(f) }),
    })
    await settle()
    expect(target.querySelector('[data-taken]')).not.toBeNull()
    // носитель на месте и ровно один
    const inputs = target.querySelectorAll('input[name="doc"]')
    expect(inputs.length).toBe(1)

    // снаружи → в вид: ручка живая
    bound.f.doc.onInput('привет')
    await settle()
    expect(target.querySelector('[data-live]')?.textContent).toBe('привет')

    // из вида → в форму: вид пишет значение и ошибку через свой f
    const input = inputs[0] as HTMLInputElement
    input.value = 'bad'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await settle()
    expect(bound.f.doc.value).toBe('bad')
    expect(bound.f.doc.errors.map((e) => e.code)).toContain('doc.unprepared')
    await cleanup()
  })

  test('base не совпал — штатный компонент, замены нет', async () => {
    const { target, cleanup } = setup({
      takeover: () => ({ view: TakeoverView, base: CopyField }),
    })
    await settle()
    expect(target.querySelector('[data-taken]')).toBeNull()
    expect(target.querySelector('input[name="doc"]')).not.toBeNull()
    await cleanup()
  })

  test('instead сильнее перехвата', async () => {
    const { target, cleanup } = setup({
      takeover: (f) => ({ view: TakeoverView, base: fieldViews.resolveView(f) }),
      instead: CopyField,
    })
    await settle()
    expect(target.querySelector('[data-taken]')).toBeNull()
    expect(target.innerHTML).toContain('Копировать')
    await cleanup()
  })
})

suite('Field takeover: f.pending на настоящей форме', () => {
  test('отправка ждёт подготовку и перечитывает DOM', async () => {
    let release!: () => void
    const { bound, target, spy, cleanup } = setup({
      takeover: (f) => {
        f.pending = new Promise<void>((res) => {
          release = res
        })
      },
    })
    await settle()
    const form = target.querySelector('form')!
    const input = target.querySelector('input[name="doc"]') as HTMLInputElement
    const type = async (value: string) => {
      input.value = value
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await settle()
    }
    await type('сырьё')

    const p = bound.submit(new FormData(form))
    await settle()
    expect(spy).not.toHaveBeenCalled()

    // за время ожидания носитель получил итоговое значение
    await type('готов')
    release()
    const r = await p
    expect(r?.ok).toBe(true)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0]![0].data.get('doc')).toBe('готов')
    await cleanup()
  })
})
