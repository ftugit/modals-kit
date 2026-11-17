import { test } from 'vitest'
import assert from 'node:assert/strict'
import { createRegistry, explainMissing, globalScope, registerModal } from './registry'
import type { ModalDefinition } from './types'

const def = (name: string, extra: Partial<ModalDefinition> = {}): any => ({
  name,
  component: `<${name}>`,
  ...extra,
})

/* ── область видимости ─────────────────────────────────────────────── */

test('своя область находит своё', () => {
  const films = createRegistry('/films').define([def('card')])
  const hit = films.resolve('card')
  assert.equal(hit?.scope, '/films')
  assert.equal(hit?.definition.component, '<card>')
})

test('подъём к родителю: роут → layout → глобальная', () => {
  const app = createRegistry('global').define([def('auth')])
  const shop = app.child('/shop').define([def('cart')])
  const item = shop.child('/shop/[id]').define([def('gallery')])

  assert.equal(item.resolve('gallery')?.scope, '/shop/[id]')
  assert.equal(item.resolve('cart')?.scope, '/shop')
  assert.equal(item.resolve('auth')?.scope, 'global')
  assert.equal(item.resolve('нет'), undefined)
})

test('вниз реестр НЕ смотрит: чужой роут не виден', () => {
  const app = createRegistry('global')
  const films = app.child('/films').define([def('card')])
  const users = app.child('/users')
  assert.ok(films.resolve('card'))
  assert.equal(users.resolve('card'), undefined, 'соседний роут не должен быть виден')
})

test('одноимённые модалки в разных роутах сосуществуют', () => {
  const app = createRegistry('global')
  const films = app.child('/films').define([def('card', { color: 'красный' })])
  const users = app.child('/users').define([def('card', { color: 'синий' })])
  assert.equal(films.resolve('card')?.definition.color, 'красный')
  assert.equal(users.resolve('card')?.definition.color, 'синий')
})

test('ближняя область перекрывает дальнюю', () => {
  const app = createRegistry('global').define([def('card', { color: 'общий' })])
  const films = app.child('/films').define([def('card', { color: 'свой' })])
  assert.equal(films.resolve('card')?.definition.color, 'свой')
  assert.equal(films.resolve('card')?.scope, '/films')
  assert.equal(app.resolve('card')?.definition.color, 'общий', 'родителя не испортили')
})

/* ── то, что оригинал делал молча ──────────────────────────────────── */

test('повторное объявление в ОДНОЙ области — ошибка, а не тихая перезапись', () => {
  const films = createRegistry('/films').define([def('card')])
  assert.throws(() => films.define([def('card')]), /уже объявлена в области/)
})

test('повторное объявление ТОГО ЖЕ объекта безвредно (двойной импорт модуля)', () => {
  const same = def('card')
  const films = createRegistry('/films').define([same])
  assert.doesNotThrow(() => films.define([same]))
})

/* ── диагностика ───────────────────────────────────────────────────── */

test('ошибка называет, где искали и что доступно', () => {
  const app = createRegistry('global').define([def('auth')])
  const films = app.child('/films').define([def('card')])
  const msg = explainMissing('нету', films)
  assert.match(msg, /Нет модалки «нету»/)
  assert.match(msg, /\/films → global/, 'перечислены области поиска')
  assert.match(msg, /auth/)
  assert.match(msg, /card/)
})

test('ошибка подсказывает, если имя есть в НЕвидимой области', () => {
  const app = createRegistry('global')
  const films = app.child('/films')
  const users = app.child('/users').define([def('profile')])
  const msg = explainMissing('profile', films, [users])
  assert.match(msg, /объявлено в: \/users/)
  assert.match(msg, /отсюда не видна/)
  assert.match(msg, /общего родителя/, 'сказано, что делать')
})

test('пустая область говорит об этом прямо', () => {
  assert.match(explainMissing('x', createRegistry('/пусто')), /не объявлено ни одной/)
})

/* ── совместимость и интеграция ────────────────────────────────────── */

test('registerModal по-прежнему работает — кладёт в глобальную область', () => {
  globalScope.clear()
  registerModal(def('settings'))
  assert.equal(globalScope.resolve('settings')?.scope, 'global')
  const route = globalScope.child('/любой')
  assert.ok(route.resolve('settings'), 'глобальные видны из любого роута')
  globalScope.clear()
})

test('lookup — готовая функция для кодека ядра', () => {
  const films = createRegistry('/films').define([def('card', { defaultParams: { id: 1 } })])
  const lookup = films.lookup
  assert.equal(lookup('card')?.name, 'card')
  assert.equal(lookup('нет'), undefined)
  assert.deepEqual(lookup('card')?.defaultParams, { id: 1 })
})

test('visible перечисляет всё видимое, ближние перекрывают дальние', () => {
  const app = createRegistry('global').define([def('auth'), def('card')])
  const films = app.child('/films').define([def('card'), def('poster')])
  assert.deepEqual(films.visible(), ['auth', 'card', 'poster'])
  assert.equal(films.visible().filter((n) => n === 'card').length, 1, 'без дублей')
})
