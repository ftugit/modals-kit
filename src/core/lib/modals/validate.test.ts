// Ход 12: F28 (цвет из адреса/localStorage → inline style), F36 (якорь, размеры).
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { decodeChain, resolveEntry, shellStyle } from './core'
import { createRegistry } from './registry'
import { parseStoredChain } from './storages'
import { isSafeCssColor } from './validate'

const scope = createRegistry('validate').define([
  { name: 'a', component: 'a', size: { width: 400 } } as any,
])
const decode = (q: string) => decodeChain(q, scope.lookup)[0]

test('F28: допустимые цвета, включая палитру демо', () => {
  for (const ok of [
    'red', 'transparent', '#fff', '#a1b2c3d4', 'rgb(1 2 3 / 50%)', 'hsl(200, 50%, 40%)',
    'oklch(0.7 0.1 200)', 'var(--card)', 'var(--x, #000)',
    'color-mix(in oklab, var(--chart-1) 8%, var(--card))',
  ]) assert.equal(isSafeCssColor(ok), true, ok)
})

test('F28: инъекция объявлений и внешние ресурсы отвергаются', () => {
  for (const bad of [
    'red;position:fixed;inset:0;z-index:2147483647',
    'url(http://evil.example/p.png)',
    'url(http://evil.example/p.png) center/cover',
    'image-set("x.png" 1x)',
    'red center/cover',
    'var(evil)',
    'rgb(1,2,3',
    'red)',
    'color-mix(in oklab, url(x) 5%, red)',
    'red !important',
    '/* */red',
    '',
  ]) assert.equal(isSafeCssColor(bad), false, bad)
})

test('F28: decodeChain не пропускает опасный цвет в стиль оболочки', () => {
  const evil = decode('?modal=a&modal.0.color=' + encodeURIComponent('red;position:fixed;inset:0') +
    '&modal.0.tailColor=' + encodeURIComponent('url(http://evil.example/t.png)'))
  assert.equal(evil.overrides.color, undefined)
  assert.equal(evil.overrides.tailColor, undefined)
  const style = shellStyle(resolveEntry(evil, 0, scope.lookup), undefined)
  assert.equal(String(style.background).includes('position'), false)

  const fine = decode('?modal=a&modal.0.color=' + encodeURIComponent('color-mix(in oklab, var(--chart-1) 8%, var(--card))'))
  assert.equal(fine.overrides.color, 'color-mix(in oklab, var(--chart-1) 8%, var(--card))')
})

test('F28/F36: localStorage-запись проверяется по полям', () => {
  const [e] = parseStoredChain(JSON.stringify([{
    name: 'a',
    overrides: { color: 'red;position:fixed', tailColor: '#000', mobile: 'evil', size: { width: 'x', height: 300 }, lock: 'yes', noForward: true },
  }]))
  assert.deepEqual(e.overrides, { tailColor: '#000', size: { height: 300 }, noForward: true })
})

test('F36: мусорный якорь и размеры из адреса отбрасываются', () => {
  const e = decode('?modal=a&modal.0.mobile=evil&modal.0.size.width=abc&modal.0.size.depth=5&modal.0.size.height=-1')
  assert.equal(e.overrides.mobile, undefined)
  assert.equal(e.overrides.size, undefined)
  const ok = decode('?modal=a&modal.0.mobile=off&modal.0.size.width=640')
  assert.equal(ok.overrides.mobile, 'off')
  assert.deepEqual(ok.overrides.size, { width: 640 })
})
