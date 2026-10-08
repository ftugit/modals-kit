// Приёмка: 21 проверка `test/checks/modals.mjs` оригинала.
//
// Совместимость разобрана в TESTS-COMPAT.md: DOM совпадает, программный API
// сменил форму (модульные синглтоны стали методами). Утверждения здесь
// те же, меняется только способ вызова. Нумерация соответствует оригиналу.
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { buildCore } from './build'
import { createModals } from './create'
import { createLoader } from './loader'
import { createRegistry, globalScope, registerModal } from './registry'
import { memoryEngine, type ChainEngine } from './engine'
import { localStorageChain, parseStoredChain, urlStorage } from './storages'
import {
  chainToSearch, decodeChain, hasLockedEntry, isChainLocked,
} from './core'
import { entryLabel, type Chain, type RegisteredEntry } from './types'

const reg = (name: string, params: Record<string, unknown> = {}, overrides = {}): RegisteredEntry => ({
  kind: 'registered', name, params, overrides,
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
  return { _m: m, getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v) }, removeItem: (k: string) => { m.delete(k) } }
}
const none = () => undefined
const sys = (scope = createRegistry('t'), engine = hist()) => {
  const core = buildCore(engine, urlStorage(), { lookup: scope.lookup })
  const m = createModals(core); m.attach()
  return { m, core, scope, engine }
}

/* ── 1–4: кодек и блокировки (работают без правок) ─────────────────── */

test('1. decodeChain: пусто и мусор → пустая цепочка (deny-safe)', () => {
  assert.deepEqual(decodeChain('', none), [])
  assert.deepEqual(decodeChain('?q=1', none), [])
  assert.deepEqual(decodeChain('?modal=', none), [])
  assert.deepEqual(decodeChain('?modal=,,', none), [])
})

test('2. encode/decode round-trip: только отличия от регистратора', () => {
  const lookup = (n: string) => (n === 'card' ? def('card', { defaultParams: { tab: 'a' } }) : undefined)
  const search = chainToSearch([reg('card', { tab: 'a', id: 7 })], lookup as any)
  assert.doesNotMatch(search, /tab/, 'значение по умолчанию в адрес не пишется')
  assert.match(search, /modal\.0\.id=7/)
  const back = decodeChain(search, lookup as any)
  assert.equal(back[0].params.id, 7)
})

test('3. pack: не-флаттные значения уезжают JSON-пакетом', () => {
  const weird = { list: [{ deep: 1 }] }
  const search = chainToSearch([reg('x', { weird })], none)
  assert.match(search, /pack=/)
  assert.deepEqual(decodeChain(search, none)[0].params.weird, weird)
})

test('4. isChainLocked / hasLockedEntry', () => {
  const lookup = (n: string) => (n === 'locked' ? def('locked', { lock: true }) : def(n))
  assert.equal(isChainLocked([reg('a'), reg('locked')], lookup as any), true)
  assert.equal(isChainLocked([reg('locked'), reg('a')], lookup as any), false, 'важна только верхняя')
  assert.equal(hasLockedEntry([reg('locked'), reg('a')], lookup as any), true)
  assert.equal(hasLockedEntry([reg('a')], lookup as any), false)
})

/* ── 5–8: реестр и действия ────────────────────────────────────────── */

test('5. registerModal: имя в реестре; getModal/listModals → область', () => {
  globalScope.clear()
  registerModal(def('auth'))
  assert.equal(globalScope.resolve('auth')?.definition.name, 'auth')
  assert.deepEqual(globalScope.visible(), ['auth'])
  globalScope.clear()
})

test('6. open → цепочка растёт, close → сужается', () => {
  const { m } = sys()
  m.open('a'); m.open('b')
  assert.deepEqual(names(m.chain), ['a', 'b'])
  m.close()
  assert.deepEqual(names(m.chain), ['a'])
})

test('7. closeAll → пустая цепочка', () => {
  const { m } = sys()
  m.open('a'); m.open('b'); m.open('c')
  assert.equal(m.closeAll(), true)
  assert.deepEqual(m.chain, [])
})

test('8. forceClose(name) закрывает конкретную; без имени — верхнюю', () => {
  // Как в оригинале (fakeChainStore): логика forceClose без живой истории —
  // закрытие идёт через write(replace), метка глубины не участвует.
  const core = buildCore(memoryEngine(), urlStorage(), { lookup: createRegistry('t8').lookup })
  const m = createModals(core); m.attach()
  m.open('a'); m.open('b'); m.open('c')
  m.forceClose('b')
  assert.deepEqual(names(m.chain), ['a', 'c'])
  m.forceClose()
  assert.deepEqual(names(m.chain), ['a'])
})

// Дыра, вскрытая этим тестом при живой истории (hist-движок): после
// НЕконцевой правки (forceClose в середине) метка глубины на текущей записи
// расходится с содержимым соседних записей. Закрытие верхней шагает go(-1)
// на запись ДО неконцевой правки — и стопка «вырастает» обратно:
// a,b,c → forceClose('b') → a,c (pushState) → forceClose() → back(1) →
// go(-1) попадает на запись «a,b,c», не на «a».
//
// Это наследие ОРИГИНАЛА, не регрессия порта: adapter-url считает шаги так же
// (`Math.min(steps, __modalsDepth - chain.length)`), а его тесты использовали
// fakeChainStore без истории и дыру не видели. Вопрос владельцу — чинить
// (закрытие после неконцевой правки должно идти replace'ом, для чего ядру
// надо помнить, что текущая запись переписана неконцевым образом) или
// оставить как есть. test.fails: зелёный, пока поведение дырявое — починят,
// покраснеет и дыра не забудется.
test('8a. закрытие после неконцевой правки при живой истории', () => {
  const { m } = sys()
  m.open('a'); m.open('b'); m.open('c')
  m.forceClose('b')
  m.forceClose()
  assert.deepEqual(names(m.chain), ['a'])
})

/* ── 9–11: lock и noForward ────────────────────────────────────────── */

test('9. lock: верхняя заблокированная не закрывается, closeAll блокируется', () => {
  const scope = createRegistry('t').define([def('a'), def('locked', { lock: true })])
  const { m } = sys(scope)
  m.open('a'); m.open('locked')
  assert.equal(m.close(), false)
  assert.equal(m.closeAll(), false)
  assert.deepEqual(names(m.chain), ['a', 'locked'])
  m.forceClose()
  assert.deepEqual(names(m.chain), ['a'], 'forceClose — единственный путь')
})

test('10. lock НЕ сверху: верхняя закрывается, стопка доходит до lock', () => {
  const scope = createRegistry('t').define([def('locked', { lock: true }), def('b')])
  const { m } = sys(scope)
  m.open('locked'); m.open('b')
  assert.equal(m.close(), true, 'верхняя не заблокирована')
  assert.deepEqual(names(m.chain), ['locked'])
  assert.equal(m.close(), false, 'дальше — нельзя')
})

test('9b. lock: внешняя навигация Назад не закрывает заблокированную', () => {
  const scope = createRegistry('t').define([def('a'), def('locked', { lock: true })])
  const e = hist()
  const { m } = sys(scope, e)
  m.open('a'); m.open('locked')
  e.go(-1)
  assert.deepEqual(names(m.chain), ['a', 'locked'], 'адрес возвращён обратно')
})

test('11. noForward: «Вперёд» не восстанавливает такую модалку', () => {
  const scope = createRegistry('t').define([def('a'), def('flash', { noForward: true })])
  const e = hist()
  const { m } = sys(scope, e)
  m.open('a'); m.open('flash')
  assert.deepEqual(names(m.chain), ['a', 'flash'])
  m.close()
  assert.deepEqual(names(m.chain), ['a'])
  e.go(1)
  assert.deepEqual(names(m.chain), ['a'], 'обратно не всплыла')
})

/* ── 12–14: предзагрузка ───────────────────────────────────────────── */

test('12. preloadModal кэширует — повтор мгновенный', async () => {
  let calls = 0
  const scope = createRegistry('t').define([def('c', { loader: async () => { calls++; return 'x' } })])
  const { m } = sys(scope)
  const l = createLoader({ store: m.store, lookup: scope.lookup })
  assert.deepEqual(await l.preloadModal('c', {}), { ok: true })
  assert.deepEqual(await l.preloadModal('c', {}), { ok: true })
  assert.equal(calls, 1)
})

test('13. preloadModal: нет модалки → ok:false с причиной', async () => {
  const { m } = sys()
  const l = createLoader({ store: m.store, lookup: () => undefined })
  const r = await l.preloadModal('ghost', {})
  assert.equal(r.ok, false)
  assert.match((r as any).error, /Нет такой модалки/)
})

test('14. preloadModal: загрузчик упал → ok:false с сообщением', async () => {
  const scope = createRegistry('t').define([
    def('bad', { loader: async () => { throw new Error('сервер лёг') } }),
  ])
  const { m } = sys(scope)
  const l = createLoader({ store: m.store, lookup: scope.lookup })
  const r = await l.preloadModal('bad', {})
  assert.equal(r.ok, false)
  assert.equal((r as any).error, 'сервер лёг')
})

/* ── 15–17: транспорт и история ────────────────────────────────────── */

test('15. адресный транспорт: write → навигация с меткой глубины, read из адреса', () => {
  const e = hist()
  const core = buildCore(e, urlStorage())
  core.write([reg('card', { id: 7 })])
  const entry = e._stack[e._i()]
  assert.match(entry.url, /modal=card/)
  assert.equal((entry.state as any).modals.depth, 1, 'глубина записана')
  assert.deepEqual(names(core.read()), ['card'])
})

test('16. back(): при недостаточной глубине — replace текущей записи', () => {
  const e = hist()
  const core = buildCore(e, urlStorage())
  core.write([reg('a')])
  // метку глубины теряем, как после перезагрузки
  e._stack[e._i()].state = {}
  const len = e._stack.length
  core.back!(1, [])
  assert.equal(e._stack.length, len, 'новой записи не добавилось')
  assert.deepEqual(core.read(), [], 'закрылось заменой')
})

test('17. back(): при достаточной глубине — шаг по истории, без новой записи', () => {
  const e = hist()
  const core = buildCore(e, urlStorage())
  core.write([reg('a')])
  core.write([reg('a'), reg('b')])
  const len = e._stack.length
  core.back!(1, [reg('a')])
  assert.equal(e._stack.length, len, 'стек не обрезан — «Вперёд» жив')
  assert.deepEqual(names(core.read()), ['a'])
})

/* ── 18: отпадает ──────────────────────────────────────────────────── */
// `modalSearch()` — валидатор `validateSearch` роута. У SvelteKit такого
// механизма нет, проверка теряет смысл. Отклонение записано в журнал §6.

/* ── 19–21: хранилище и SSR ────────────────────────────────────────── */

test('19. localStorage: write/read round-trip, пусто → []', () => {
  const st = fakeStore()
  const core = buildCore(hist(), localStorageChain(st))
  core.write([reg('a'), reg('b')])
  assert.deepEqual(names(buildCore(hist(), localStorageChain(st)).read()), ['a', 'b'])
  core.write([])
  assert.deepEqual(buildCore(hist(), localStorageChain(st)).read(), [])
})

test('20. localStorage: битый JSON → [] (deny-safe)', () => {
  assert.deepEqual(parseStoredChain('не json'), [])
  assert.deepEqual(parseStoredChain('{"не":"массив"}'), [])
  const st = fakeStore()
  st._m.set('modals:chain', '<<битое>>')
  assert.deepEqual(buildCore(hist(), localStorageChain(st)).read(), [])
})

test('21. работает без window и document — действия не падают', () => {
  // memoryEngine ничего из окружения не трогает: это и есть путь SSR.
  const core = buildCore(memoryEngine('/x'), urlStorage())
  const m = createModals(core)
  assert.doesNotThrow(() => {
    m.attach()
    m.open('a')
    m.close()
    m.closeAll()
    m.forceClose()
  })
  assert.equal(core.capabilities.history, false, 'без истории — и это нормально')
})

/* ── события жизненного цикла (были в registry.ts оригинала) ───────── */

test('жизненный цикл: onOpen / onClose / onHostOpen / onHostClose', () => {
  const log: string[] = []
  const scope = createRegistry('t').define([
    def('a', { onOpen: () => log.push('open:a'), onClose: () => log.push('close:a') }),
    def('b', { onOpen: () => log.push('open:b') }),
  ])
  const core = buildCore(hist(), urlStorage(), { lookup: scope.lookup })
  const m = createModals(core, {
    onHostOpen: () => log.push('host:open'),
    onHostClose: () => log.push('host:close'),
    onModalOpen: (c) => log.push(`modal:${c.name}`),
  })
  m.attach()
  m.open('a'); m.open('b')
  m.closeAll()
  assert.deepEqual(log, [
    'open:a', 'modal:a', 'host:open',
    'open:b', 'modal:b',
    'close:a', 'host:close',
  ])
})

/* ─────────────── Q1: канал приёмников (createModals) ─────────────── */

test('Q2x. onError: config-приёмник + регистрация хоста, отписка уважаема', () => {
  const seen: string[] = []
  const core = buildCore(memoryEngine(), urlStorage(), { lookup: createRegistry('q1m').lookup })
  const m = createModals(core, {
    onError: (e: { code: string }) => seen.push('cfg:' + e.code),
  })
  const off = m.onError((e: { code: string }) => seen.push('host:' + e.code))
  m.reportError({ lib: 'modals', code: 'x', cause: null })
  assert.deepEqual(seen, ['cfg:x', 'host:x'])
  off()
  m.reportError({ lib: 'modals', code: 'y', cause: null })
  assert.deepEqual(seen, ['cfg:x', 'host:x', 'cfg:y'])
})
