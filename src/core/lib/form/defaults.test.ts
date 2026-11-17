// Умолчания описания — это значения формы (ход 269).
//
// Регресс хода 224: `defaultValue` жил только в атрибуте разметки. Следствия —
// `Select` умолчание не показывал, стёртое текстовое поле возвращало умолчание
// в `value`, очистить его было нельзя. Здесь проверяются обе стороны контракта:
// значения формы начинаются с умолчаний, а разметка их больше не подставляет.
import { describe as suite, expect, test } from 'vitest'
import { defaultValueMap } from './defaults'
import { defaultUi } from './svelte/config'
import { defineForm, makeFieldSugar } from './index'

const field = makeFieldSugar()

const form = defineForm({
  id: 'defaults',
  fields: {
    plan: field.select({
      label: 'Тариф',
      options: [
        { value: 'free', label: 'Бесплатный' },
        { value: 'pro', label: 'Профи' },
      ],
      defaultValue: 'pro',
    }),
    plan_multi: field.multiselect({
      label: 'Каналы',
      options: [
        { value: 'mail', label: 'Почта' },
        { value: 'sms', label: 'СМС' },
      ],
      defaultValue: ['mail', 'sms'],
    }),
    title: field.text({ label: 'Заголовок', defaultValue: 'Черновик' }),
    count: field.number({ label: 'Писем', defaultValue: 4 }),
    agree: field.checkbox({ label: 'Согласен', defaultValue: true }),
    empty: field.text({ label: 'Без умолчания' }),
  },
})

suite('defaultValueMap', () => {
  test('умолчания полей становятся начальными значениями формы', () => {
    expect(defaultValueMap(form)).toEqual({
      plan: 'pro',
      plan_multi: ['mail', 'sms'],
      title: 'Черновик',
      count: 4,
      agree: true,
    })
  })

  test('поле без умолчания в карту не попадает', () => {
    expect('empty' in defaultValueMap(form)).toBe(false)
  })

  test('карта — снимок, а не ссылка на описание', () => {
    const map = defaultValueMap(form)
    map.title = 'другое'
    expect(defaultValueMap(form).title).toBe('Черновик')
  })
})

suite('valueAttrs: разметка умолчание не дублирует', () => {
  test('пустое значение — пустые атрибуты, даже если у поля есть умолчание', () => {
    expect(defaultUi.valueAttrs({ kind: 'text', defaultValue: 'Черновик' }, '')).toEqual({})
    expect(defaultUi.valueAttrs({ kind: 'select', defaultValue: 'pro' }, undefined)).toEqual({})
  })

  test('значение из формы уходит в атрибут как раньше', () => {
    expect(defaultUi.valueAttrs({ kind: 'text', defaultValue: 'Черновик' }, 'Мой текст')).toEqual({
      value: 'Мой текст',
    })
    expect(defaultUi.valueAttrs({ kind: 'number' }, 0)).toEqual({ value: '0' })
  })

  test('чекбокс — по значению, а не по наличию умолчания', () => {
    expect(defaultUi.valueAttrs({ kind: 'checkbox', defaultValue: true }, false)).toEqual({})
    expect(defaultUi.valueAttrs({ kind: 'checkbox' }, true)).toEqual({ checked: true })
  })

  test('выбранное умолчание селекта приходит значением, а не атрибутом-заглушкой', () => {
    const values = defaultValueMap(form)
    expect(defaultUi.valueAttrs({ kind: 'select', defaultValue: 'pro' }, values.plan)).toEqual({
      value: 'pro',
    })
  })
})
