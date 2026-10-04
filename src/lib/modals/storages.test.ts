import { test } from 'vitest'
import assert from 'node:assert/strict'
import { buildCore } from './build'
import { memoryEngine, type ChainEngine } from './engine'
import { localStorageChain, memoryStorage, parseStoredChain, urlStorage } from './storages'
import { entryLabel, type Chain, type RegisteredEntry } from './types'
import {
  assertTransient,
  assertTransientOnTop,
  canLink,
  canPreload,
} from './core-contract'

const registered = (name: string, params: Record<string, unknown> = {}): RegisteredEntry => ({
  kind: 'registered', name, params, overrides: {},
})
const transient = (id: string): any => ({ kind: 'transient', id, overrides: {} })
const names = (c: Chain) => c.map(entryLabel)

function historyEngine(url = '/'): ChainEngine & { _stack: any[]; _i: () => number } {
  const stack: Array<{ url: string; state: Record<string, unknown> }> = [{ url, state: {} }]
  let i = 0
  const pops = new Set<() => void>()
  return {
    name: 'history',
    _stack: stack,
    _i: () => i,
    location() {
      const u = new URL(stack[i].url, 'http://x')
      return { pathname: u.pathname, search: u.search }
    },
    pushState(u, s) { stack.length = i + 1; stack.push({ url: u, state: s }); i = stack.length - 1 },
    replaceState(u, s) { stack[i] = { url: u, state: s } },
    state: () => stack[i].state,
    onPopState(fn) { pops.add(fn); return () => pops.delete(fn) },
    go(d) { i = Math.max(0, Math.min(stack.length - 1, i + d)); pops.forEach((f) => f()) },
  }
}

function fakeStorage() {
  const map = new Map<string, string>()
  return {
    _map: map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => map.set(k, v),
    removeItem: (k: string) => map.delete(k),
  }
}

/* ── переговоры о возможностях ─────────────────────────────────────── */

test('возможности выводятся из сочетания движка и хранилища', () => {
  const noHistory = buildCore(memoryEngine(), urlStorage())
  assert.equal(noHistory.back, undefined, 'движок без go — истории нет')
  assert.equal(canLink(noHistory), true, 'но адрес есть')

  const local = buildCore(historyEngine(), localStorageChain(fakeStorage()))
  assert.equal(typeof local.back, 'function', 'история от движка')
  assert.equal(canLink(local), false, 'ссылкой не передать')

  assert.equal(typeof buildCore(historyEngine(), memoryStorage()).subscribe, 'function')
  assert.equal(canPreload(buildCore(historyEngine(), urlStorage())), false)
})

test('транспорт без transient обязан сказать это внятно', () => {
  const a = buildCore(memoryEngine(), memoryStorage())
  assert.throws(
    () => assertTransient({ ...a, capabilities: { ...a.capabilities, transient: false } }),
    /не поддерживает transient/,
  )
})

/* ── правило «transient только на вершине» ─────────────────────────── */

test('transient ниже registered — ошибка, называющая причину', () => {
  assert.throws(() => assertTransientOnTop([transient('t1'), registered('card')]), /позиционно/)
  assert.doesNotThrow(() => assertTransientOnTop([registered('a'), transient('t1'), transient('t2')]))
})

/* ── кодек адреса ──────────────────────────────────────────────────── */

test('кодек: скаляры декодируются по типу', () => {
  const a = buildCore(historyEngine(), urlStorage())
  a.write([registered('x', { n: 42, flag: true, nothing: null, text: 'abc' })])
  const p = (a.read()[0] as RegisteredEntry).params
  assert.equal(p.n, 42)
  assert.equal(p.flag, true)
  assert.equal(p.nothing, null)
  assert.equal(p.text, 'abc')
})

test('кодек: вложенные объекты едут точечными ключами', () => {
  const a = buildCore(historyEngine(), urlStorage())
  a.write([registered('x', { filter: { from: 2020, to: 2024 } })])
  assert.deepEqual((a.read()[0] as RegisteredEntry).params.filter, { from: 2020, to: 2024 })
})

test('кодек: неплоское значение уезжает в pack', () => {
  const e = historyEngine()
  const a = buildCore(e, urlStorage())
  const weird = { list: [{ deep: 1 }] }
  a.write([registered('x', { weird })])
  assert.match(e._stack[e._i()].url, /pack=/)
  assert.deepEqual((a.read()[0] as RegisteredEntry).params.weird, weird)
})

test('кодек: битый pack не валит разбор (deny-safe)', () => {
  const e = historyEngine('/?modal=x&modal.0.pack=%7Bсломано')
  const a = buildCore(e, urlStorage())
  assert.equal(a.read().length, 1)
  assert.deepEqual((a.read()[0] as RegisteredEntry).params, {})
})

test('кодек: чужие ключи адреса не теряются', () => {
  const e = historyEngine('/?q=1&sort=asc')
  const a = buildCore(e, urlStorage())
  a.write([registered('card')])
  const u = e._stack[e._i()].url
  assert.match(u, /q=1/)
  assert.match(u, /sort=asc/)
  assert.match(u, /modal=card/)
})

test('кодек: пустая стопка чистит свои ключи', () => {
  const e = historyEngine('/?q=1')
  const a = buildCore(e, urlStorage())
  a.write([registered('card')])
  a.write([])
  const u = e._stack[e._i()].url
  assert.match(u, /q=1/)
  assert.doesNotMatch(u, /modal/)
})

test('кодек: fullpage и размеры', () => {
  const e = historyEngine()
  const a = buildCore(e, urlStorage())
  a.write([{ kind: 'registered', name: 'x', params: {}, overrides: { size: 'fullpage' } }])
  assert.match(e._stack[e._i()].url, /size=fullpage/)
  assert.equal((a.read()[0] as RegisteredEntry).overrides.size, 'fullpage')
})

/* ── localStorage: разбор и отказы ─────────────────────────────────── */

test('local: битые данные не валят стопку (deny-safe)', () => {
  assert.deepEqual(parseStoredChain(null), [])
  assert.deepEqual(parseStoredChain('не json'), [])
  assert.deepEqual(parseStoredChain('{"не":"массив"}'), [])
  const mixed = parseStoredChain(JSON.stringify([{ name: 'ok' }, { нет: 'имени' }, { name: '' }]))
  assert.equal(mixed.length, 1, 'мусорная запись выбрасывается поодиночке')
  assert.equal(mixed[0].name, 'ok')
  assert.deepEqual(mixed[0].params, {})
})

test('local: отказ записи (приватный режим) не роняет модалку', () => {
  const st = fakeStorage()
  st.setItem = () => { throw new DOMException('QuotaExceededError') }
  const a = buildCore(historyEngine(), localStorageChain(st))
  assert.doesNotThrow(() => a.write([registered('card')]))
  // в носитель не легло, но запись истории всё равно есть — слой открыт
  assert.deepEqual(names(a.read()), ['card'])
})

test('local: пустая стопка стирает ключ, а не пишет "[]"', () => {
  const st = fakeStorage()
  const a = buildCore(historyEngine(), localStorageChain(st))
  a.write([registered('card')])
  assert.ok(st._map.has('modals:chain'))
  a.write([])
  assert.equal(st._map.has('modals:chain'), false)
})

/* ── память ────────────────────────────────────────────────────────── */

test('memory: ничего не переживает и не отражается в адресе', () => {
  const e = historyEngine()
  const a = buildCore(e, memoryStorage())
  a.write([registered('card')])
  assert.deepEqual(names(a.read()), ['card'])
  assert.equal(e._stack[e._i()].url, '/', 'адрес чистый')
  assert.equal(a.capabilities.addressable, false)
})

/* ── подписка ──────────────────────────────────────────────────────── */

test('subscribe получает свои записи и внешнюю навигацию', () => {
  const e = historyEngine()
  const a = buildCore(e, urlStorage())
  const seen: number[] = []
  const off = a.subscribe!((c) => seen.push(c.length))
  a.write([registered('card')])
  a.write([registered('card'), registered('user')])
  e.go(-1)
  off()
  a.write([])
  assert.deepEqual(seen, [1, 2, 1], 'после отписки события не приходят')
})

test('local: недоступное хранилище не роняет систему (сторонний iframe)', () => {
  // В стороннем iframe сам доступ к localStorage бросает SecurityError.
  const blocked = {
    getItem() { throw new DOMException('SecurityError') },
    setItem() { throw new DOMException('SecurityError') },
    removeItem() { throw new DOMException('SecurityError') },
  }
  const core = buildCore(historyEngine(), localStorageChain(blocked))
  assert.deepEqual(core.read(), [], 'чтение вернуло пустое, а не упало')
  assert.doesNotThrow(() => core.write([registered('card')]))
  // слой всё равно открыт: цепочка живёт в записи истории
  assert.deepEqual(names(core.read()), ['card'])
})
