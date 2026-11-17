// ДОКАЗАТЕЛЬСТВО: одно и то же ядро обслуживает оба способа объявления —
// общий регистратор и область одного маршрута — на роутере FastEdge.
//
// Здесь не переписано ничего, кроме `fastedge.ts`: модалка, хранилища,
// кодек и реестр те же самые.
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { fastEdgeCore, type FastEdgeRouter } from './fastedge'
import { createModals } from '../create'
import { createRegistry, explainMissing, globalScope, registerModal } from '../registry'
import { localStorageChain, urlStorage } from '../storages'
import { entryLabel, type Chain, type RegisteredEntry } from '../types'

const registered = (name: string, params: Record<string, unknown> = {}): RegisteredEntry => ({
  kind: 'registered', name, params, overrides: {},
})
const names = (c: Chain) => c.map(entryLabel)
const def = (name: string, extra: Record<string, unknown> = {}): any => ({
  name, component: `<${name}>`, ...extra,
})

/** Модель роутера FastEdge: navigate строкой + state в history.state. */
function fakeFastEdge(start = '/'): FastEdgeRouter & { _stack: any[]; _i: () => number } {
  const stack: Array<{ url: string; state: Record<string, unknown> }> = [{ url: start, state: {} }]
  let i = 0
  const subs = new Set<() => void>()
  return {
    _stack: stack,
    _i: () => i,
    searchStr: () => new URL(stack[i].url, 'http://x').search,
    pathname: () => new URL(stack[i].url, 'http://x').pathname,
    navigate(url, opts) {
      if (opts.replace) stack[i] = { url, state: opts.state ?? {} }
      else {
        stack.length = i + 1
        stack.push({ url, state: opts.state ?? {} })
        i = stack.length - 1
      }
      subs.forEach((f) => f())
    },
    onSearchChange(fn) { subs.add(fn); return () => subs.delete(fn) },
    state: () => stack[i].state,
    go(d) { i = Math.max(0, Math.min(stack.length - 1, i + d)); subs.forEach((f) => f()) },
    // ✅ то, чего у SvelteKit нет: рантайм-проверка маршрута
    resolves: (href) => ['/', '/shikimori', '/cards'].includes(href.split('?')[0]),
  }
}

/* ══════════════════════════════════════════════════════════════════
   ВАРИАНТ A. Общий регистратор — как сейчас в SolidHono
   ══════════════════════════════════════════════════════════════════ */

test('[A] общий регистратор: модалка видна с любого маршрута', () => {
  globalScope.clear()
  registerModal(def('auth'))
  registerModal(def('settings'))

  const router = fakeFastEdge('/')
  const core = fastEdgeCore(router, urlStorage(), { lookup: globalScope.lookup })
  const modals = createModals(core, { tailCount: 3 })
  modals.attach()

  core.write([registered('auth')])
  assert.deepEqual(names(modals.chain), ['auth'])
  assert.match(router._stack[router._i()].url, /modal=auth/)

  // тот же реестр виден и с другого маршрута
  const other = fakeFastEdge('/cards')
  const core2 = fastEdgeCore(other, urlStorage(), { lookup: globalScope.lookup })
  assert.ok(globalScope.resolve('auth'), 'глобальная модалка доступна везде')
  core2.write([registered('settings')])
  assert.match(other._stack[other._i()].url, /modal=settings/)

  globalScope.clear()
})

/* ══════════════════════════════════════════════════════════════════
   ВАРИАНТ B. Область одного маршрута — /shikimori
   ══════════════════════════════════════════════════════════════════ */

test('[B] область маршрута: модалки shikimori живут только там', () => {
  globalScope.clear()
  registerModal(def('auth')) // общая — видна отовсюду

  // объявляется рядом со страницей, а не в глобальной карте
  const shikimori = globalScope.child('/shikimori').define([
    def('shikimori-record', { size: { width: 720 }, mobile: 'bottom' }),
    def('shikimori-filters', { mobile: 'left' }),
  ])
  const cards = globalScope.child('/cards').define([def('card')])

  // своя
  assert.equal(shikimori.resolve('shikimori-record')?.scope, '/shikimori')
  // общая — через родителя
  assert.equal(shikimori.resolve('auth')?.scope, 'global')
  // 🔴 чужая — не видна
  assert.equal(shikimori.resolve('card'), undefined)
  assert.equal(cards.resolve('shikimori-record'), undefined)

  globalScope.clear()
})

test('[B] ядро работает с областью маршрута так же, как с общей', () => {
  globalScope.clear()
  const shikimori = globalScope
    .child('/shikimori')
    .define([def('shikimori-record', { defaultParams: { tab: 'info' } })])

  const router = fakeFastEdge('/shikimori')
  const core = fastEdgeCore(router, urlStorage(), { lookup: shikimori.lookup })
  const modals = createModals(core, { tailCount: 2 })
  modals.attach()

  core.write([registered('shikimori-record', { id: 42, tab: 'info' })])

  const url = router._stack[router._i()].url
  assert.match(url, /^\/shikimori\?/, 'путь маршрута сохранён')
  assert.match(url, /modal=shikimori-record/)
  assert.match(url, /modal\.0\.id=42/)
  // tab совпал с defaultParams области → в адрес не пишется
  assert.doesNotMatch(url, /tab=/, 'умолчание реестра области учтено кодеком')

  assert.deepEqual(names(modals.chain), ['shikimori-record'])
  assert.equal((modals.chain[0] as RegisteredEntry).params.id, 42)

  globalScope.clear()
})

/* ══════════════════════════════════════════════════════════════════
   ОБА ВАРИАНТА ОДНОВРЕМЕННО, ОДНО ЯДРО
   ══════════════════════════════════════════════════════════════════ */

test('[A+B] общая и маршрутная модалка в одной стопке', () => {
  globalScope.clear()
  registerModal(def('auth'))
  const shikimori = globalScope.child('/shikimori').define([def('shikimori-record')])

  const router = fakeFastEdge('/shikimori')
  const core = fastEdgeCore(router, urlStorage(), { lookup: shikimori.lookup })
  const modals = createModals(core)
  modals.attach()

  // Открываем по одной — как это делает пользователь: каждое открытие
  // создаёт СВОЮ запись истории. (Один write на две записи дал бы один
  // шаг истории, и Назад откатил бы обе разом.)
  core.write([registered('shikimori-record', { id: 7 })])
  core.write([registered('shikimori-record', { id: 7 }), registered('auth')])
  assert.deepEqual(names(modals.chain), ['shikimori-record', 'auth'])

  // Назад снимает верхнюю — общую, объявленную в другой области
  core.back!(1, [registered('shikimori-record', { id: 7 })])
  assert.deepEqual(names(modals.chain), ['shikimori-record'], 'маршрутная осталась')

  // ещё раз — снимается маршрутная
  core.back!(1, [])
  assert.deepEqual(names(modals.chain), [])

  globalScope.clear()
})

test('[A+B] ошибка объясняет, что имя есть в невидимой области', () => {
  globalScope.clear()
  const shikimori = globalScope.child('/shikimori')
  const cards = globalScope.child('/cards').define([def('card')])

  const msg = explainMissing('card', shikimori, [cards])
  assert.match(msg, /объявлено в: \/cards/)
  assert.match(msg, /отсюда не видна/)

  globalScope.clear()
})

/* ══════════════════════════════════════════════════════════════════
   СПЕЦИФИКА FASTEDGE
   ══════════════════════════════════════════════════════════════════ */

test('FastEdge: resolves работает в рантайме (теперь и у SvelteKit — таблица роутов, №30)', () => {
  const core = fastEdgeCore(fakeFastEdge())
  assert.equal(typeof core.resolves, 'function')
  assert.equal(core.resolves!('/shikimori'), true)
  assert.equal(core.resolves!('/shikimori?modal=x'), true)
  assert.equal(core.resolves!('/нет-такого'), false)
})

test('FastEdge: одна navigate обслуживает и push, и replace', () => {
  const r = fakeFastEdge()
  const core = fastEdgeCore(r)
  core.write([registered('a')])
  const afterPush = r._stack.length
  core.write([registered('a'), registered('b')], { replace: true })
  assert.equal(r._stack.length, afterPush, 'replace не добавил запись')
  assert.deepEqual(names(core.read()), ['a', 'b'])
})

test('FastEdge: state кладётся ПЛОСКО, без обёртки фреймворка', () => {
  const r = fakeFastEdge()
  const core = fastEdgeCore(r)
  core.write([registered('a')])
  const st = r._stack[r._i()].state as any
  assert.ok(st.modals, 'ключ модалок на верхнем уровне history.state')
  assert.equal(st.modals.depth, 1)
  assert.equal(st['sveltekit:states'], undefined, 'обёртки SvelteKit тут нет')
})

test('FastEdge: смена хранилища работает так же, как у SvelteKit', () => {
  const r = fakeFastEdge()
  const store = new Map<string, string>()
  const core = fastEdgeCore(r, localStorageChain({
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => { store.set(k, v) },
    removeItem: (k) => { store.delete(k) },
  }))

  assert.equal(core.capabilities.addressable, false)
  assert.equal(core.capabilities.history, true, 'история — от роутера FastEdge')

  core.write([registered('shikimori-record')])
  assert.equal(r._stack[r._i()].url, '/', 'адрес чистый')
  assert.match(store.get('modals:chain')!, /shikimori-record/)
})
