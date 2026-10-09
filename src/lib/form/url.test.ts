// Этап 4, S1: url-кодек формы — чистые преобразования, без DOM и транспорта.
import { expect, test } from 'vitest'
import { defineForm, makeFieldSugar, readUrlForm, writeUrlForm } from './index'
import { decode } from './decode'

const field = makeFieldSugar()

const demo = defineForm({
  id: 'url-demo',
  fields: {
    q: field.text({}),
    agree: field.checkbox({}),
  },
})

test('read: search → значения тем же decode-путём, что POST', () => {
  const { values, structural } = readUrlForm('q=%D0%BA%D0%BE%D1%82&agree=on&utm=x', demo)
  expect(values.q).toBe('кот')
  expect(values.agree).toBe(true)
  expect(structural).toHaveLength(0)
  // чужой параметр — не значение формы
  expect(values).not.toHaveProperty('utm')
})

test('read: отсутствие ключа = дефолт, а не ошибка', () => {
  const { values, structural } = readUrlForm('', demo)
  expect(values.q).toBe('')
  expect(values.agree).toBe(false)
  expect(structural).toHaveLength(0)
})

test('write: дефолт и пустое не пишутся; чужие ключи base целы', () => {
  const qs = writeUrlForm({ q: '', agree: false }, demo, 'utm=keep&page=2')
  expect(qs).toBe('utm=keep&page=2')
  const qs2 = writeUrlForm({ q: 'кот', agree: true }, demo, 'utm=keep')
  expect(new URLSearchParams(qs2).getAll('q')).toEqual(['кот'])
  expect(new URLSearchParams(qs2).get('agree')).toBe('on')
})

test('write: сброс значения убирает ключ (не оставляет мусор от base)', () => {
  const withVal = writeUrlForm({ q: 'кот' }, demo)
  expect(withVal).toBe('q=%D0%BA%D0%BE%D1%82')
  const cleared = writeUrlForm({ q: '' }, demo, withVal)
  expect(cleared).toBe('')
})

test('round-trip: read∘write сохраняет непустые значения', () => {
  const values = { q: 'пёс 2', agree: true }
  const back = readUrlForm(writeUrlForm(values, demo), demo)
  expect(back.values.q).toBe('пёс 2')
  expect(back.values.agree).toBe(true)
})

test('кодек и POST-декодер согласованы: один FormData → те же значения', () => {
  const fd = new FormData()
  fd.set('q', 'кот')
  fd.set('agree', 'on')
  const params = new URLSearchParams([['q', 'кот'], ['agree', 'on']])
  expect(readUrlForm(params, demo).values).toEqual(decode(fd, demo).values)
})
