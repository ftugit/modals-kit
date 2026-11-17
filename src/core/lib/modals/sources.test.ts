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

  e.go!(-1); assert.deepEqual(names(m.chain), ['a', 'b'])
  e.go!(-1); assert.deepEqual(names(m.chain), ['a'])
  e.go!(1);  assert.deepEqual(names(m.chain), ['a', 'b'], 'Вперёд тоже')
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

test('addressableIndex на смешанных источниках url + local + memory и очистка m<k>.* в chainToSearch', () => {
  const scope = createRegistry('t').define([
    def('list'),
    def('picker', { source: 'memory' }),
    def('filters', { defaultParams: { uids: '' } }),
    def('wizard', { source: 'local' }),
  ])
  const engine = hist('/?m0.users.q=bob&modal=list')
  const m = createModals(buildCore(engine, sources(), { lookup: scope.lookup }))
  m.attach()

  assert.equal(m.addressableIndex(0), 0, 'первая url-модалка имеет urlIndex 0')

  m.open('picker')
  assert.equal(m.addressableIndex(0), 0)
  assert.equal(m.addressableIndex(1), null, 'memory-модалка не адресуема')
  assert.equal(engine.location().search, '?m0.users.q=bob&modal=list', 'picker не попал в URL')

  m.open('filters')
  assert.equal(m.addressableIndex(2), 1, 'вторая url-модалка имеет urlIndex 1 даже после memory-слоя')
  assert.equal(engine.location().search, '?m0.users.q=bob&modal=list%2Cfilters')

  // Обновление черновых параметров на месте (setParams)
  assert.equal(m.setParams(2, { uids: 'u1,u2' }, { reload: false }), true)
  assert.equal(
    engine.location().search,
    '?m0.users.q=bob&modal=list%2Cfilters&modal.1.uids=u1%2Cu2',
  )

  // Полное закрытие стопки (closeAll -> replaceState) атомарно стирает и modal, и m0.*
  m.closeAll()
  assert.equal(engine.location().search, '', 'm0.users.q атомарно очищен вместе с цепочкой')
})

test('асинхронный go(-1) при close() дочерней memory-модалки не откатывает синхронный setParams родителя', () => {
  const scope = createRegistry('t').define([
    def('create', { defaultParams: { uids: '' } }),
    def('picker', { source: 'memory' }),
  ])
  const stack: Array<{ url: string; state: Record<string, unknown> }> = [{ url: '/blocks', state: {} }]
  let i = 0
  const pops = new Set<() => void>()
  const pendingGo: { run?: () => void } = {}
  const asyncEngine: ChainEngine = {
    name: 'history',
    location() {
      const u = new URL(stack[i].url, 'http://x')
      return { pathname: u.pathname, search: u.search }
    },
    pushState(u, s) {
      stack.length = i + 1
      stack.push({ url: u, state: s })
      i = stack.length - 1
    },
    replaceState(u, s) {
      stack[i] = { url: u, state: s }
    },
    state: () => stack[i].state,
    onPopState(fn) {
      pops.add(fn)
      return () => pops.delete(fn)
    },
    go(d) {
      pendingGo.run = () => {
        i = Math.max(0, Math.min(stack.length - 1, i + d))
        pops.forEach((f) => f())
      }
    },
  }

  const m = createModals(buildCore(asyncEngine, sources(), { lookup: scope.lookup }))
  m.attach()
  m.open('create', { params: { uids: 'u1' } })
  m.store.merge('runtime', {
    '0:create': { status: 'ready', data: { assignableScopes: ['auth'] }, ck: 'create|uids="u1"' },
  })
  m.open('picker')

  // Пикер пишет выбор и закрывается (запускается отложенный go(-1)), а родитель
  // синхронно в том же такте обновляет свои параметры через setParams({ reload: false }).
  m.store.merge('sharedData', { 'picker:subjects': { seq: 1, ids: ['u1', 'u2'] } })
  m.close()
  assert.ok(pendingGo.run, 'браузерный go(-1) ещё в полёте')
  assert.equal(m.setParams(0, { uids: 'u1,u2' }, { reload: false }), true)

  // Приходит отложенный popstate от go(-1): параметры и runtime родителя обязаны уцелеть!
  pendingGo.run!()
  assert.equal(m.chain.length, 1)
  assert.deepEqual((m.chain[0] as RegisteredEntry).params, { uids: 'u1,u2' })
  assert.equal(
    asyncEngine.location().search,
    '?modal=create&modal.0.uids=u1%2Cu2',
    'отложенный replace записал обновлённые параметры на целевую запись истории',
  )
  assert.equal(
    m.store.state.runtime['0:create']?.status,
    'ready',
    'runtime родительского слота не был сброшен промежуточным устаревшим URL',
  )
})



test('setParams нетерминального родителя до back сохраняется при асинхронном popstate', () => {
  const scope = createRegistry('t').define([
    def('create', { defaultParams: { uids: '' } }),
    def('picker', { source: 'memory' }),
  ])
  const stack: Array<{ url: string; state: Record<string, unknown> }> = [{ url: '/blocks', state: {} }]
  let i = 0
  const pops = new Set<() => void>()
  const pendingGo: { run?: () => void } = {}
  const asyncEngine: ChainEngine = {
    name: 'history',
    location() {
      const u = new URL(stack[i].url, 'http://x')
      return { pathname: u.pathname, search: u.search }
    },
    pushState(u, s) {
      stack.length = i + 1
      stack.push({ url: u, state: s })
      i = stack.length - 1
    },
    replaceState(u, s) {
      stack[i] = { url: u, state: s }
    },
    state: () => stack[i].state,
    onPopState(fn) {
      pops.add(fn)
      return () => pops.delete(fn)
    },
    go(d) {
      pendingGo.run = () => {
        i = Math.max(0, Math.min(stack.length - 1, i + d))
        pops.forEach((f) => f())
      }
    },
  }

  const m = createModals(buildCore(asyncEngine, sources(), { lookup: scope.lookup }))
  m.attach()
  m.open('create', { params: { uids: 'u1' } })
  m.store.merge('runtime', {
    '0:create': { status: 'ready', data: { assignableScopes: ['auth'] }, ck: 'create|uids="u1"' },
  })
  m.open('picker')

  // Пикер пишет выбор и закрывается (запускается отложенный go(-1)), а родитель
  // синхронно в том же такте обновляет свои параметры через setParams({ reload: false }).
  m.store.merge('sharedData', { 'picker:subjects': { seq: 1, ids: ['u1', 'u2'] } })
  assert.equal(m.setParams(0, { uids: 'u1,u2' }, { reload: false }), true)
  m.close()
  assert.ok(pendingGo.run, 'браузерный go(-1) ещё в полёте')

  // Приходит отложенный popstate от go(-1): параметры и runtime родителя обязаны уцелеть!
  pendingGo.run!()
  assert.equal(m.chain.length, 1)
  assert.deepEqual((m.chain[0] as RegisteredEntry).params, { uids: 'u1,u2' })
  assert.equal(
    asyncEngine.location().search,
    '?modal=create&modal.0.uids=u1%2Cu2',
    'отложенный replace записал обновлённые параметры на целевую запись истории',
  )
  assert.equal(
    m.store.state.runtime['0:create']?.status,
    'ready',
    'runtime родительского слота не был сброшен промежуточным устаревшим URL',
  )
})
