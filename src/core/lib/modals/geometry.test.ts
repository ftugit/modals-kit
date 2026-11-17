// Геометрия оболочки — чистая математика, проверяется числами без DOM.
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { mobileAnchorOf, radiusFor, shellBox, shellStyle, tailStyle, viewportStyle } from './core'
import type { ResolvedEntry } from './types'

const entry = (over: Partial<ResolvedEntry> = {}): ResolvedEntry => ({
  name: 'x', index: 0, params: {}, size: { width: 480 },
  color: '#fff', tailColor: '#eee', lock: false, noForward: false, known: true, ...over,
})

test('мобильный якорь действует только у модалки с mobile', () => {
  assert.equal(mobileAnchorOf(entry({ mobile: 'bottom' }), true), 'bottom')
  assert.equal(mobileAnchorOf(entry({ mobile: 'bottom' }), false), undefined, 'широкий экран')
  assert.equal(mobileAnchorOf(entry(), true), undefined, 'mobile не задан')
  assert.equal(mobileAnchorOf(null, true), undefined)
})

test('прижатие внутри viewport', () => {
  assert.deepEqual(viewportStyle(undefined), {
    'align-items': 'center', 'justify-content': 'center', padding: '16px',
  })
  assert.equal(viewportStyle('bottom')['align-items'], 'flex-end')
  assert.equal(viewportStyle('top')['align-items'], 'flex-start')
  assert.equal(viewportStyle('left')['justify-content'], 'flex-start')
  assert.equal(viewportStyle('right')['justify-content'], 'flex-end')
})

test('радиус: у fullpage нет, с прижатой стороны срезан', () => {
  assert.equal(radiusFor(entry({ size: 'fullpage' }), undefined), '0px')
  assert.equal(radiusFor(entry(), undefined), '16px')
  assert.equal(radiusFor(entry(), 'bottom'), '16px 16px 0 0')
  assert.equal(radiusFor(entry(), 'top'), '0 0 16px 16px')
  assert.equal(radiusFor(entry(), 'left'), '0 16px 16px 0')
  assert.equal(radiusFor(entry(), 'right'), '16px 0 0 16px')
})

test('габариты: fullpage, боковые, прижатые сверху/снизу', () => {
  assert.deepEqual(shellBox(entry({ size: 'fullpage' }), undefined), {
    width: '100%', height: '100%', 'max-width': '100%', 'max-height': '100%',
  })
  assert.equal(shellBox(entry(), 'left').width, 'min(420px, 88vw)')
  assert.equal(shellBox(entry(), 'bottom').width, '100%')
  assert.equal(shellBox(entry(), 'bottom')['max-height'], '80vh')
})

test('высота из регистратора — МИНИМУМ, а не лимит', () => {
  const box = shellBox(entry({ size: { width: 520, height: 420 } }), undefined)
  assert.equal(box['min-height'], 'min(420px, calc(100vh - 32px))', 'height стал min-height')
  assert.equal(box['max-height'], '80vh', 'потолок — из настроек хоста')
  assert.equal(box.height, undefined, 'жёсткой высоты нет')
})

test('maxHeight из настроек хоста доходит до габаритов', () => {
  assert.equal(shellBox(entry(), undefined, '90vh')['max-height'], '90vh')
})

test('shellStyle добавляет цвет и радиус', () => {
  const s = shellStyle(entry({ color: 'red' }), 'bottom')
  assert.equal(s.background, 'red')
  assert.equal(s['border-radius'], '16px 16px 0 0')
})

const tail = (over: Record<string, unknown> = {}) =>
  tailStyle({
    activeEntry: entry(), tailEntry: entry({ tailColor: '#ccc' }),
    depthFromTop: 1, direction: 'bottom', tailScale: 0.94,
    anchor: undefined, stackAnimation: 'cards', entered: true, ...over,
  })

test('хвост: смещение, масштаб и глубина', () => {
  const t = tail()
  assert.equal(t.transform, 'translate3d(0px, 14px, 0) scale(0.94) rotate(0deg)')
  assert.equal(t['z-index'], -1)
  assert.equal(t.background, '#ccc')
  assert.equal(t.position, 'absolute')
  assert.equal(t['pointer-events'], 'none')
})

test('хвост: до появления совпадает с оболочкой — отсюда «уход в стопку»', () => {
  const t = tail({ entered: false })
  assert.equal(t.transform, 'translate3d(0,0,0) scale(1) rotate(0deg)')
  assert.equal(t.opacity, 0.9)
})

test('хвост: режимы стопки различаются шагом и поворотом', () => {
  assert.match(String(tail({ stackAnimation: 'deck' }).transform), /0px, 22px/)
  assert.match(String(tail({ stackAnimation: 'fan', direction: 'left' }).transform), /rotate\(2deg\)/)
  const none = tail({ stackAnimation: 'none' })
  assert.equal(none.transform, 'translate3d(0px, 0px, 0) scale(1) rotate(0deg)')
})

test('хвост: прозрачность падает с глубиной, но не ниже 0.25', () => {
  assert.equal(tail({ depthFromTop: 1 }).opacity, 1 - 0.18)
  assert.equal(tail({ depthFromTop: 10 }).opacity, 0.25, 'пол по прозрачности')
})
