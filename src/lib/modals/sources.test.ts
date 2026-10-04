// Несколько источников: закрепление модалок и общий порядок стопки.
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { buildCore } from './build'
import { createModals } from './create'
import { createRegistry } from './registry'
import { type ChainEngine } from './engine'
import { localStorageChain, memoryStorage, urlStorage } from './storages'
import { entryLabel, type Chain, type RegisteredEntry } from './types'

const reg = (name: string, params: Record<string, unknown> = {}): RegisteredEntry => ({
  kind: 'registered', name, params, overrides: {},
})
const names = (c: Chain) => c.map(entryLabel)
const def = (name: string, extra: Record<string, unknown> = {}): any => ({ name, component: name, ...extra })

function hist(start = '/'): ChainEngine & { _stack: any[]; _i: () => number } {
  const stack: Array<{ url: string; state: Record<string, unknown> }> = [{ url: start, state: {} }]
  let i = 0
  const pops = new Set<() => void>()
  return {
    name: 'history', _stack: stack, _i: () => i,
    location() { const u = new URL(stack[i].url, 'http://x'); return { pathname: u.pathname, search: u.search } },
    pushState(u, s) { stack.length = i + 1; stack.push({ url: u, state: s }); i = stack.length - 1 },
    replaceState(u, s) { stack[i] = { url: u, state: s } },
    state: () => stack[i].state,
    onPopState(fn) { pops.add(fn); return () => pops.delete(fn) },
    go(d) { i = Math.max(0, Math.min(stack.length - 1, i + d)); pops.forEach((f) => f()) },
  }
}
const fakeStore = () => {
  const m = new Map<string, string>()
  return { _m: m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v) }, removeItem: (k: string) => { m.delete(k) } }
}

const sources = () => ({ url: urlStorage(), local: localStorageChain(fakeStore()), memory: memoryStorage() })

/* ── закрепление ───────────────────────────────────────────────────── */

test('модалка пишется в закреплённый за ней источник', () => {
  const scope = createRegistry('t').define([
    def('card'),                        // без указания → источник по умолчанию (url)
    def('wizard', { source: 'local' }),
    def('debug', { source: 'memory' }),
  ])
  const e = hist()
  const core = buildCore(e, sources(), { lookup: scope.lookup })

  core.write([reg('card'), reg('wizard'), reg('debug')])

  const url = e._stack[e._i()].url
  assert.match(url, /modal=card/, 'card в адресе')
  assert.doesNotMatch(url, /wizard|debug/, 'остальные в адрес не попали')

  const read = core.read() as RegisteredEntry[]
  assert.deepEqual(names(read), ['card', 'wizard', 'debug'])
  assert.deepEqual(read.map((x) => x.source), ['url', 'local', 'memory'])
})

test('модалка, закреплённая за несколькими источниками', () => {
  const scope = createRegistry('t').define([def('flex', { source: ['local', 'memory'] })])
  const core = buildCore(hist(), sources(), { lookup: scope.lookup })
  core.write([reg('flex')])
  assert.equal((core.read()[0] as RegisteredEntry).source, 'local', 'пишется в первый из списка')
})

test('явный source при открытии перебивает объявление', () => {
  const scope = createRegistry('t').define([def('card', { source: 'url' })])
  const core = buildCore(hist(), sources(), { lookup: scope.lookup })
  const m = createModals(core)
  m.attach()
  m.open('card', { source: 'memory' })
  assert.equal((m.chain[0] as RegisteredEntry).source, 'memory')
})

test('source — размещение, а не разрешение', () => {
  // 'card' закреплена за url, но найденная в memory всё равно показывается:
  // иначе явный open(name, { source }) молча терялся бы.
  const scope = createRegistry('t').define([def('card', { source: 'url' })])
  const mem = memoryStorage([reg('card')])
  const core = buildCore(hist(), { url: urlStorage(), memory: mem }, { lookup: scope.lookup })
  const read = core.read() as RegisteredEntry[]
  assert.deepEqual(names(read), ['card'])
  assert.equal(read[0].source, 'memory', 'источник — тот, где нашлась')
})

/* ── порядок ───────────────────────────────────────────────────────── */

test('🎯 порядок по ВРЕМЕНИ открытия, а не по порядку источников', () => {
  const scope = createRegistry('t').define([
    def('inUrl', { source: 'url' }),
    def('inMem', { source: 'memory' }),
  ])
  const core = buildCore(hist(), sources(), { lookup: scope.lookup })
  const m = createModals(core)
  m.attach()

  // memory объявлен ПОСЛЕ url, но открыт раньше — значит должен быть ниже
  m.open('inMem')
  m.open('inUrl')
  assert.deepEqual(names(m.chain), ['inMem', 'inUrl'])

  // и наоборот
  m.closeAll()
  m.open('inUrl')
  m.open('inMem')
  assert.deepEqual(names(m.chain), ['inUrl', 'inMem'], 'новое всегда сверху')
})

test('Назад откатывает смешанную стопку по одному слою', () => {
  const scope = createRegistry('t').define([
    def('a', { source: 'url' }),
    def('b', { source: 'local' }),
    def('c', { source: 'memory' }),
  ])
  const e = hist()
  const m = createModals(buildCore(e, sources(), { lookup: scope.lookup }))
  m.attach()
  m.open('a'); m.open('b'); m.open('c')
  assert.deepEqual(names(m.chain), ['a', 'b', 'c'])

  e.go(-1); assert.deepEqual(names(m.chain), ['a', 'b'])
  e.go(-1); assert.deepEqual(names(m.chain), ['a'])
  e.go(1);  assert.deepEqual(names(m.chain), ['a', 'b'], 'Вперёд тоже')
})

/* ── долговечность по источникам ───────────────────────────────────── */

test('после перезагрузки выживают url и local, memory — нет', () => {
  const scope = createRegistry('t').define([
    def('a', { source: 'url' }),
    def('b', { source: 'local' }),
    def('c', { source: 'memory' }),
  ])
  const e = hist()
  const shared = fakeStore()
  const mk = () => ({ url: urlStorage(), local: localStorageChain(shared), memory: memoryStorage() })

  const m1 = createModals(buildCore(e, mk(), { lookup: scope.lookup }))
  m1.attach(); m1.open('a'); m1.open('b'); m1.open('c')
  assert.deepEqual(names(m1.chain), ['a', 'b', 'c'])

  // «перезагрузка»: адрес и носители целы, состояние записи потеряно
  e._stack[e._i()].state = {}
  const m2 = createModals(buildCore(e, mk(), { lookup: scope.lookup }))
  m2.attach()
  assert.deepEqual(names(m2.chain), ['a', 'b'], 'memory не пережил, остальные да')
})

test('без указания источников всё как раньше — один url', () => {
  const core = buildCore(hist(), urlStorage())
  assert.equal(core.name, 'history(url)')
  core.write([reg('card')])
  assert.deepEqual(names(core.read()), ['card'])
})

test('имя ядра перечисляет источники', () => {
  assert.equal(buildCore(hist(), sources()).name, 'history(url+local+memory)')
})

/* ── долговечность зеркала: что переживает перезагрузку ────────────── */

test('memory НЕ воскресает после перезагрузки, local — воскресает', () => {
  const scope = createRegistry('t').define([
    def('a', { source: 'local' }),
    def('b', { source: 'memory' }),
  ])
  const e = hist()
  const shared = fakeStore()
  const mk = () => ({ local: localStorageChain(shared), memory: memoryStorage() })

  const m1 = createModals(buildCore(e, mk(), { lookup: scope.lookup }))
  m1.attach(); m1.open('a'); m1.open('b')
  assert.deepEqual(names(m1.chain), ['a', 'b'])

  // «Перезагрузка»: запись истории (с зеркалом) цела — она переживает F5,
  // а содержимое памяти вкладки — нет. Носители создаются заново.
  const m2 = createModals(buildCore(e, mk(), { lookup: scope.lookup }))
  m2.attach()
  assert.deepEqual(names(m2.chain), ['a'], 'зеркало memory не должно воскрешать слой')
})

test('предзаполненный memory читается, пока зеркала ещё нет', () => {
  // Зеркала нет вовсе → это первый заход, начальному содержимому верим.
  const core = buildCore(hist(), { memory: memoryStorage([reg('seed')]) })
  assert.deepEqual(names(core.read()), ['seed'])
})

test('закрытие стирает запись из её носителя', () => {
  const scope = createRegistry('t').define([def('a', { source: 'local' })])
  const store = fakeStore()
  const m = createModals(buildCore(hist(), { local: localStorageChain(store) }, { lookup: scope.lookup }))
  m.attach()
  m.open('a')
  assert.ok(store._m.get('modals:chain')?.includes('"a"'))
  m.close()
  assert.equal(store._m.has('modals:chain'), false, 'ключ удалён, а не оставлен пустым')
})
