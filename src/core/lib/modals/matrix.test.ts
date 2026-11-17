// Матрица: каждая среда × каждое хранилище, один и тот же набор сценариев.
//
// Выборочные тесты доказывают, что «у меня получилось», а матрица — что
// поведение не зависит от сочетания. Здесь же явно закреплены РАЗЛИЧИЯ:
// там, где сочетание обязано деградировать, проверяется именно деградация,
// а не «оно как-нибудь работает».
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { buildCore } from './build'
import { createModals } from './create'
import { memoryEngine, type ChainEngine } from './engine'
import { fastEdgeEngine } from './cores/fastedge'
import { localStorageChain, memoryStorage, urlStorage, type ChainStorage } from './storages'
import { entryLabel, type Chain, type RegisteredEntry } from './types'
import { canLink } from './core-contract'

const registered = (name: string, params: Record<string, unknown> = {}): RegisteredEntry => ({
  kind: 'registered', name, params, overrides: {},
})
const transient = (id: string): any => ({ kind: 'transient', id, overrides: {} })
const names = (c: Chain) => c.map(entryLabel)

/* ── среды ─────────────────────────────────────────────────────────── */

/** Полноценная история, состояние под ключом (форма SvelteKit). */
function historyEngine(start = '/'): ChainEngine & { _reset(): void } {
  const stack: Array<{ url: string; state: Record<string, unknown> }> = [{ url: start, state: {} }]
  let i = 0
  const pops = new Set<() => void>()
  return {
    name: 'history',
    location() {
      const u = new URL(stack[i].url, 'http://x')
      return { pathname: u.pathname, search: u.search }
    },
    pushState(u, s) { stack.length = i + 1; stack.push({ url: u, state: s }); i = stack.length - 1 },
    replaceState(u, s) { stack[i] = { url: u, state: s } },
    state: () => stack[i].state,
    onPopState(fn) { pops.add(fn); return () => pops.delete(fn) },
    go(d) { i = Math.max(0, Math.min(stack.length - 1, i + d)); pops.forEach((f) => f()) },
    /** «Перезагрузка»: адрес остался, состояние записи потеряно. */
    _reset() { stack[i] = { url: stack[i].url, state: {} } },
  }
}

/** Роутер FastEdge: одна navigate, плоское состояние. */
function fastEdge(start = '/'): ChainEngine & { _reset(): void } {
  const stack: Array<{ url: string; state: Record<string, unknown> }> = [{ url: start, state: {} }]
  let i = 0
  const subs = new Set<() => void>()
  const e = fastEdgeEngine({
    searchStr: () => new URL(stack[i].url, 'http://x').search,
    pathname: () => new URL(stack[i].url, 'http://x').pathname,
    navigate(url, o) {
      if (o.replace) stack[i] = { url, state: o.state ?? {} }
      else { stack.length = i + 1; stack.push({ url, state: o.state ?? {} }); i = stack.length - 1 }
      subs.forEach((f) => f())
    },
    onSearchChange(fn) { subs.add(fn); return () => subs.delete(fn) },
    state: () => stack[i].state,
    go(d) { i = Math.max(0, Math.min(stack.length - 1, i + d)); subs.forEach((f) => f()) },
  })
  return { ...e, _reset() { stack[i] = { url: stack[i].url, state: {} } } }
}

/** Среда без истории — случай SSR. */
function ssr(start = '/'): ChainEngine & { _reset(): void } {
  const e = memoryEngine(start)
  return { ...e, _reset() {} }
}

const ENGINES = [
  ['history', historyEngine, true],
  ['fastedge', fastEdge, true],
  ['ssr', ssr, false], // истории нет
] as const

/* ── хранилища ─────────────────────────────────────────────────────── */

function fakeStorage() {
  const map = new Map<string, string>()
  return {
    _map: map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v) },
    removeItem: (k: string) => { map.delete(k) },
  }
}

type StorageCase = { name: string; make: () => ChainStorage; addressable: boolean; durable: boolean }

const STORAGES: StorageCase[] = [
  { name: 'url', make: () => urlStorage(), addressable: true, durable: true },
  { name: 'local', make: () => localStorageChain(fakeStorage()), addressable: false, durable: true },
  { name: 'memory', make: () => memoryStorage(), addressable: false, durable: false },
]

/* ══════════════════════════════════════════════════════════════════
   ИНВАРИАНТЫ: обязаны выполняться во ВСЕХ девяти сочетаниях
   ══════════════════════════════════════════════════════════════════ */

for (const [engName, mkEngine, hasHistory] of ENGINES) {
  for (const st of STORAGES) {
    const label = `${engName}(${st.name})`

    test(`${label}: read/write — цепочка возвращается как записана`, () => {
      const core = buildCore(mkEngine(), st.make())
      assert.deepEqual(core.read(), [])
      core.write([registered('card')])
      assert.deepEqual(names(core.read()), ['card'])
      core.write([registered('card'), registered('user', { id: 7 })])
      assert.deepEqual(names(core.read()), ['card', 'user'])
      assert.equal((core.read()[1] as RegisteredEntry).params.id, 7)
      core.write([])
      assert.deepEqual(core.read(), [])
    })

    test(`${label}: transient лежит поверх, в носитель не попадает`, () => {
      const core = buildCore(mkEngine(), st.make())
      core.write([registered('card'), transient('t1')])
      const c = core.read()
      assert.deepEqual(names(c), ['card', 't1'])
      assert.equal(c[0].kind, 'registered')
      assert.equal(c[1].kind, 'transient')
    })

    test(`${label}: transient в середине запрещён`, () => {
      const core = buildCore(mkEngine(), st.make())
      assert.throws(() => core.write([transient('t1'), registered('card')]), /позиционно/)
    })

    test(`${label}: подписка получает свои изменения`, () => {
      const core = buildCore(mkEngine(), st.make())
      const seen: number[] = []
      const off = core.subscribe!((c) => seen.push(c.length))
      core.write([registered('a')])
      core.write([registered('a'), registered('b')])
      off()
      core.write([])
      assert.deepEqual(seen, [1, 2], 'после отписки — тишина')
    })

    test(`${label}: модалка собирается и видит цепочку`, () => {
      const core = buildCore(mkEngine(), st.make())
      const modals = createModals(core, { tailCount: 2 })
      modals.attach()
      core.write([registered('card')])
      assert.deepEqual(names(modals.chain), ['card'])
      assert.equal(modals.config.tailCount, 2)
    })

    /* ── РАЗЛИЧИЯ, закреплённые явно ── */

    test(`${label}: возможности соответствуют сочетанию`, () => {
      const core = buildCore(mkEngine(), st.make())
      assert.equal(core.capabilities.addressable, st.addressable, 'адресуемость — от хранилища')
      assert.equal(core.capabilities.history, hasHistory, 'история — от среды')
      assert.equal(typeof core.back === 'function', hasHistory)
      assert.equal(canLink(core), st.addressable, 'href только у адресуемого')
      assert.equal(core.capabilities.transient, true, 'transient умеют все')
    })

    test(`${label}: закрытие работает независимо от наличия истории`, () => {
      const core = buildCore(mkEngine(), st.make())
      core.write([registered('a')])
      core.write([registered('a'), registered('b')])
      if (core.back) core.back(1, [registered('a')])
      else core.write([registered('a')], { replace: true }) // деградация без истории
      assert.deepEqual(names(core.read()), ['a'])
    })
  }
}

/* ══════════════════════════════════════════════════════════════════
   ДОЛГОВЕЧНОСТЬ: что переживает перезагрузку
   ══════════════════════════════════════════════════════════════════ */

test('url: цепочка переживает перезагрузку (адрес остался)', () => {
  const e = historyEngine()
  const core = buildCore(e, urlStorage())
  core.write([registered('card'), registered('user')])
  e._reset() // состояние записи потеряно, адрес — нет
  assert.deepEqual(names(buildCore(e, urlStorage()).read()), ['card', 'user'])
})

test('local: цепочка переживает перезагрузку (носитель остался)', () => {
  const e = historyEngine()
  const shared = fakeStorage()
  buildCore(e, localStorageChain(shared)).write([registered('card'), registered('user')])
  e._reset()
  const fresh = buildCore(historyEngine(), localStorageChain(shared))
  assert.deepEqual(names(fresh.read()), ['card', 'user'], 'подхватилось из носителя')
})

test('memory: цепочка перезагрузку НЕ переживает — и это правильно', () => {
  const e = historyEngine()
  buildCore(e, memoryStorage()).write([registered('card')])
  assert.deepEqual(buildCore(historyEngine(), memoryStorage()).read(), [])
})

test('transient не переживает перезагрузку НИ В ОДНОМ сочетании', () => {
  for (const st of STORAGES) {
    const e = historyEngine()
    const core = buildCore(e, st.make())
    core.write([registered('card'), transient('t1')])
    assert.equal(core.read().length, 2, `${st.name}: до перезагрузки два слоя`)
    e._reset()
    assert.equal(
      core.read().some((x) => x.kind === 'transient'),
      false,
      `${st.name}: transient исчез`,
    )
  }
})

/* ══════════════════════════════════════════════════════════════════
   local + история: то, ради чего делалось вложение
   ══════════════════════════════════════════════════════════════════ */

test('local + история: адрес чистый, но Назад откатывает содержимое', () => {
  for (const [engName, mkEngine, hasHistory] of ENGINES) {
    if (!hasHistory) continue
    const e = mkEngine()
    const core = buildCore(e, localStorageChain(fakeStorage()))
    core.write([registered('a')])
    core.write([registered('a'), registered('b')])
    assert.equal(e.location().search, '', `${engName}: адрес не тронут`)
    core.back!(1, [registered('a')])
    assert.deepEqual(names(core.read()), ['a'], `${engName}: Назад вернул содержимое`)
  }
})

/* ══════════════════════════════════════════════════════════════════
   ЭХО-ГАРД: среды уведомляют по-разному
   ══════════════════════════════════════════════════════════════════ */

test('эхо-гард: среда, уведомляющая сама, не удваивает события', () => {
  // FastEdge: navigate синхронно дёргает подписчиков. Без гарда каждая
  // запись приходила бы дважды.
  const core = buildCore(fastEdge(), urlStorage())
  const seen: string[][] = []
  core.subscribe!((c) => seen.push(names(c)))
  core.write([registered('a')])
  core.write([registered('a'), registered('b')])
  assert.deepEqual(seen, [['a'], ['a', 'b']], 'ровно два события на две записи')
})

test('эхо-гард: среда, НЕ уведомляющая сама, событий не теряет', () => {
  // history: pushState не порождает popstate — уведомляет сам write.
  const core = buildCore(historyEngine(), urlStorage())
  const seen: string[][] = []
  core.subscribe!((c) => seen.push(names(c)))
  core.write([registered('a')])
  core.write([registered('a'), registered('b')])
  assert.deepEqual(seen, [['a'], ['a', 'b']])
})

test('эхо-гард не глушит настоящую внешнюю навигацию', () => {
  for (const [engName, mkEngine, hasHistory] of ENGINES) {
    if (!hasHistory) continue
    const e = mkEngine()
    const core = buildCore(e, urlStorage())
    const seen: string[][] = []
    core.subscribe!((c) => seen.push(names(c)))
    core.write([registered('a')])
    core.write([registered('a'), registered('b')])
    e.go!(-1)
    assert.deepEqual(seen.at(-1), ['a'], `${engName}: Назад доехал`)
    e.go!(1)
    assert.deepEqual(seen.at(-1), ['a', 'b'], `${engName}: Вперёд доехал`)
  }
})
