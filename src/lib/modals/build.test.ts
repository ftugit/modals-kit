import { test } from 'vitest'
import assert from 'node:assert/strict'
import { buildCore } from './build'
import { nextChain } from './core'
import { createModals } from './create'
import { memoryCore } from './cores/memory'
import { memoryEngine, type ChainEngine } from './engine'
import { localStorageChain, memoryStorage, urlStorage } from './storages'
import { entryLabel, type Chain, type RegisteredEntry } from './types'

const registered = (name: string, params: Record<string, unknown> = {}): RegisteredEntry => ({
  kind: 'registered', name, params, overrides: {},
})
const transient = (id: string): any => ({ kind: 'transient', id, overrides: {} })
const names = (c: Chain) => c.map(entryLabel)

/** Движок с настоящей историей — моделирует браузер. */
function historyEngine(): ChainEngine & { _stack: any[]; _i: () => number } {
  const stack: Array<{ url: string; state: Record<string, unknown> }> = [{ url: '/', state: {} }]
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
    pushState(url, state) { stack.length = i + 1; stack.push({ url, state }); i = stack.length - 1 },
    replaceState(url, state) { stack[i] = { url, state } },
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

/* ── имя транспорта читается как формула ───────────────────────────── */

test('имя собирается из движка и хранилища', () => {
  assert.equal(buildCore(memoryEngine(), urlStorage()).name, 'memory(url)')
  assert.equal(buildCore(historyEngine(), localStorageChain(fakeStorage())).name, 'history(local)')
})

/* ── одно хранилище, разные движки ─────────────────────────────────── */

test('url + движок без истории (SSR): адрес работает, back нет', () => {
  const a = buildCore(memoryEngine('/films'), urlStorage())
  assert.equal(a.capabilities.addressable, true)
  assert.equal(a.capabilities.history, false)
  assert.equal(a.back, undefined)
  a.write([registered('card')])
  assert.deepEqual(names(a.read()), ['card'])
  assert.match(a.hrefFor!([registered('card')])!, /modal=card/)
})

test('url + движок с историей: back шагает, «Вперёд» жив', () => {
  const e = historyEngine()
  const a = buildCore(e, urlStorage())
  a.write([registered('card')])
  a.write([registered('card'), registered('user')])
  const len = e._stack.length
  a.back!(1, [registered('card')])
  assert.equal(e._stack.length, len, 'стек не обрезан')
  assert.deepEqual(names(a.read()), ['card'])
})

/* ── 🎯 ТО, ЧТО РАНЬШЕ НЕ ВЫРАЖАЛОСЬ ───────────────────────────────── */

test('local + история: адрес чистый, но Назад/Вперёд работают', () => {
  const e = historyEngine()
  const st = fakeStorage()
  const a = buildCore(e, localStorageChain(st))

  assert.equal(a.capabilities.addressable, false, 'в адрес не пишем')
  assert.equal(a.capabilities.history, true, 'а история есть — от движка')

  a.write([registered('card')])
  a.write([registered('card'), registered('user')])

  assert.equal(e._stack[e._i()].url, '/', 'адрес остался чистым')
  assert.match(st._map.get('modals:chain')!, /user/, 'цепочка легла в хранилище')

  // шаг истории всё равно был — значит Назад работает
  a.back!(1, [registered('card')])
  assert.deepEqual(names(a.read()), ['card'], 'вернулись на слой назад')
})

test('local: ссылкой не передать — href не выдаётся вовсе', () => {
  const a = buildCore(historyEngine(), localStorageChain(fakeStorage()))
  assert.equal(a.hrefFor, undefined, 'нечестный href хуже отсутствующего')
})

/* ── transient одинаково во всех сочетаниях ────────────────────────── */

for (const [label, make] of [
  ['url', () => buildCore(historyEngine(), urlStorage())],
  ['local', () => buildCore(historyEngine(), localStorageChain(fakeStorage()))],
  ['memory', () => buildCore(historyEngine(), memoryStorage())],
] as const) {
  test(`[${label}] transient лежит поверх и не попадает в носитель`, () => {
    const a = make()
    a.write([registered('card'), transient('t1')])
    assert.deepEqual(names(a.read()), ['card', 't1'])
    assert.equal(a.read()[1].kind, 'transient')
  })

  test(`[${label}] transient в середине запрещён`, () => {
    assert.throws(() => make().write([transient('t1'), registered('card')]), /позиционно/)
  })
}

test('transient не переживает потерю состояния истории', () => {
  const e = historyEngine()
  const a = buildCore(e, urlStorage())
  a.write([registered('card'), transient('t1')])
  assert.equal(a.read().length, 2)
  // имитируем перезагрузку: адрес остался, состояние записи — нет
  e._stack[e._i()].state = {}
  assert.deepEqual(names(a.read()), ['card'])
})

/* ── опции ─────────────────────────────────────────────────────────── */

test('lookup из опций доходит до кодека', () => {
  const e = historyEngine()
  const a = buildCore(e, urlStorage(), {
    lookup: (n) => (n === 'known' ? ({ name: n, component: null, lock: true } as any) : undefined),
  })
  a.write([{ kind: 'registered', name: 'known', params: {}, overrides: { lock: true } }])
  assert.doesNotMatch(e._stack[e._i()].url, /lock/, 'значение по умолчанию в адрес не пишется')
})


test('local: цепочка лежит в ОБОИХ местах — история и перезагрузка', () => {
  const e = historyEngine()
  const st = fakeStorage()
  const a = buildCore(e, localStorageChain(st))
  a.write([registered('card')])
  a.write([registered('card'), registered('user')])

  // в записи истории — чтобы работало Назад
  const inHistory = (e._stack[e._i()].state as any).modals.mirror.local
  assert.deepEqual(inHistory.map((x: any) => x.name), ['card', 'user'])
  // в носителе — чтобы пережить перезагрузку
  assert.match(st._map.get('modals:chain')!, /user/)

  // Перезагрузка — это НОВОЕ ядро: память вкладки очищена, а запись
  // истории и носитель целы. Прежняя версия теста сбрасывала состояние
  // у того же ядра, и это моделировало не перезагрузку, а «мы всё ещё
  // в этой сессии, но зеркало пропало» — случай, которого не бывает.
  e._stack[e._i()].state = {}
  const fresh = buildCore(e, localStorageChain(st))
  assert.deepEqual(names(fresh.read()), ['card', 'user'], 'носитель — запасной путь')
})

test('url: цепочка в состоянии НЕ дублируется — адрес уже её несёт', () => {
  const e = historyEngine()
  const a = buildCore(e, urlStorage())
  a.write([registered('card')])
  assert.equal((e._stack[e._i()].state as any).modals.mirror, undefined)
})

/* ── модалка(ядро(хранилище), опции) ───────────────────────────────── */

test('модалка разговаривает ТОЛЬКО с ядром', () => {
  const core = buildCore(historyEngine(), urlStorage())
  const modals = createModals(core, { tailCount: 5, maxHeight: '90vh' })

  // опции по умолчанию применились
  assert.equal(modals.config.tailCount, 5)
  assert.equal(modals.config.maxHeight, '90vh')
  // а не заданные — остались дефолтными
  assert.equal(modals.config.backdropClick, 'top')

  // ядро доступно, хранилище — нет: модалка о нём не знает
  assert.equal(typeof modals.core.read, 'function')
  assert.equal((modals as any).storage, undefined)
  assert.equal((modals as any).engine, undefined)
})

test('attach читает начальную цепочку и следит за внешними изменениями', () => {
  const e = historyEngine()
  const core = buildCore(e, urlStorage())
  const modals = createModals(core)

  core.write([registered('card')])
  const off = modals.attach()
  assert.deepEqual(names(modals.chain), ['card'])

  core.write([registered('card'), registered('user')])
  assert.deepEqual(names(modals.chain), ['card', 'user'])

  e.go(-1)
  assert.deepEqual(names(modals.chain), ['card'], 'Назад доезжает через ядро')

  off()
  core.write([])
  assert.deepEqual(names(modals.chain), ['card'], 'после отписки — тишина')
})

test('open над transient отвергается до изменения in-memory и history', () => {
  const engine = historyEngine()
  const modals = createModals(buildCore(engine, urlStorage()))
  modals.attach()
  modals.open('card')
  modals.openLayer({ content: 'transient' })
  const beforeChain = [...modals.chain]
  const beforeState = structuredClone(engine.state())
  const beforeHistoryLength = engine._stack.length

  assert.throws(() => modals.open('user'), /transient-запись оказалась ниже registered/)
  assert.deepEqual(modals.chain, beforeChain, 'store не получил invalid-цепочку')
  assert.deepEqual(engine.state(), beforeState, 'history.state не изменилась')
  assert.equal(engine._stack.length, beforeHistoryLength, 'новый history-шаг не создан')
})

test('configure меняет умолчания на лету', () => {
  const modals = createModals(buildCore(memoryEngine(), memoryStorage()))
  assert.equal(modals.config.tailCount, 3)
  modals.configure({ tailCount: 1, closeIcon: false })
  assert.equal(modals.config.tailCount, 1)
  assert.equal(modals.config.closeIcon, false)
  modals.configure({ tailCount: undefined })
  assert.equal(modals.config.tailCount, 1, 'undefined не затирает')
})

test('ядро само выбирает хранилище по своей среде', () => {
  // memoryCore: истории нет — и носителю незачем переживать перезагрузку
  const c = memoryCore()
  assert.equal(c.capabilities.history, false)
  assert.equal(c.capabilities.addressable, false)
})

/* ── действия: открыть, передать параметры, закрыть ────────────────── */

test('open передаёт параметры и переопределения', () => {
  const e = historyEngine()
  const m = createModals(buildCore(e, urlStorage()))
  m.attach()
  m.open('card', { params: { id: 7, tab: 'info' }, mobile: 'bottom', size: 'fullpage' })

  const entry = m.chain[0] as any
  assert.equal(entry.kind, 'registered')
  assert.equal(entry.name, 'card')
  assert.deepEqual(entry.params, { id: 7, tab: 'info' })
  assert.equal(entry.overrides.mobile, 'bottom')
  assert.equal(entry.overrides.size, 'fullpage')
  assert.match(e._stack[e._i()].url, /modal\.0\.id=7/)
})

test('open без режима дополняет стопку', () => {
  const m = createModals(buildCore(historyEngine(), urlStorage()))
  m.attach()
  m.open('a'); m.open('b'); m.open('c')
  assert.deepEqual(names(m.chain), ['a', 'b', 'c'])
  // «Открыть с нуля» раньше не было вовсе — fromRoot оригинала жил только
  // у триггера и влиял лишь на href (журнал §6 №8). Опция `stack` у
  // действия появилась по решению владельца — тесты ниже и §6 №9.
})

test("stack: 'new' — запись заменяет всю стопку (решение владельца, §6 №9)", () => {
  const e = historyEngine()
  const m = createModals(buildCore(e, urlStorage()))
  m.attach()
  m.open('a'); m.open('b'); m.open('c')
  m.open('d', { stack: 'new' })
  assert.deepEqual(names(m.chain), ['d'], 'стопка сброшена, запись единственная')
  // адрес перестроен: только новая запись
  assert.match(e._stack[e._i()].url, /modal=d/)
  assert.ok(!/modal=a/.test(e._stack[e._i()].url))
})

test("stack: 'first' — стопка закрывается до первой, запись поверх неё", () => {
  const e = historyEngine()
  const m = createModals(buildCore(e, urlStorage()))
  m.attach()
  m.open('a'); m.open('b'); m.open('c')
  m.open('d', { stack: 'first' })
  assert.deepEqual(names(m.chain), ['a', 'd'], 'середина снята, первая осталась, новая поверх')
  assert.match(e._stack[e._i()].url, /modal=a%2Cd|modal=a,d/)
  assert.ok(!/modal=b/.test(e._stack[e._i()].url))
})

test("stack: 'first' на пустой стопке — обычное открытие", () => {
  const m = createModals(buildCore(historyEngine(), urlStorage()))
  m.attach()
  m.open('d', { stack: 'first' })
  assert.deepEqual(names(m.chain), ['d'])
})

test('nextChain: все три режима одной функцией (клик и href считают одинаково)', () => {
  const abc = [registered('a'), registered('b'), registered('c')]
  const n = (c: Chain) => c.map(entryLabel)
  assert.deepEqual(n(nextChain(abc, registered('d'))), ['a', 'b', 'c', 'd'])
  assert.deepEqual(n(nextChain(abc, registered('d'), undefined)), ['a', 'b', 'c', 'd'])
  assert.deepEqual(n(nextChain(abc, registered('d'), 'new')), ['d'])
  assert.deepEqual(n(nextChain(abc, registered('d'), 'first')), ['a', 'd'])
  assert.deepEqual(n(nextChain([], registered('d'), 'first')), ['d'])
})

test('close — шаг назад, стек «Вперёд» жив', () => {
  const e = historyEngine()
  const m = createModals(buildCore(e, urlStorage()))
  m.attach()
  m.open('a'); m.open('b')
  const len = e._stack.length
  assert.equal(m.close(), true)
  assert.equal(e._stack.length, len, 'история не обрезана')
  assert.deepEqual(names(m.chain), ['a'])
})

test('lock: верхняя не закрывается, forceClose закрывает', () => {
  const m = createModals(buildCore(historyEngine(), urlStorage()))
  m.attach()
  m.open('a'); m.open('locked', { lock: true })
  assert.equal(m.close(), false, 'заблокированная не закрылась')
  assert.equal(m.closeAll(), false, 'и всё закрыть нельзя')
  m.forceClose()
  assert.deepEqual(names(m.chain), ['a'])
})

test('openLayer кладёт transient и отдаёт содержимое по id', () => {
  const e = historyEngine()
  const m = createModals(buildCore(e, urlStorage()))
  m.attach()
  m.open('card', { params: { id: 1 } })
  const id = m.openLayer({ content: 'подтвердите удаление', size: 'fullpage' })

  assert.deepEqual(names(m.chain), ['card', id])
  assert.equal(m.chain[1].kind, 'transient')
  assert.equal(m.layerContent(id), 'подтвердите удаление')
  // адрес не изменился от разового слоя
  assert.doesNotMatch(e._stack[e._i()].url, new RegExp(id))
  m.close()
  assert.deepEqual(names(m.chain), ['card'])
})

test('openLayer падает внятно, если ядро не умеет transient', () => {
  const core = buildCore(historyEngine(), urlStorage())
  const crippled = { ...core, capabilities: { ...core.capabilities, transient: false } }
  const m = createModals(crippled)
  assert.throws(() => m.openLayer({ content: 'x' }), /не поддерживает transient/)
})

test('closeAll очищает стопку', () => {
  const m = createModals(buildCore(historyEngine(), urlStorage()))
  m.attach()
  m.open('a'); m.open('b'); m.openLayer({ content: 'c' })
  assert.equal(m.chain.length, 3)
  assert.equal(m.closeAll(), true)
  assert.deepEqual(m.chain, [])
})

test('осиротевший transient отсеивается (случай F5)', async () => {
  const e = historyEngine()
  const core = buildCore(e, urlStorage())
  const m1 = createModals(core)
  m1.attach()
  m1.open('card')
  m1.openLayer({ content: 'разовое окно' })
  assert.equal(m1.chain.length, 2)

  // «перезагрузка»: адрес и запись истории целы, память вкладки — нет
  const m2 = createModals(buildCore(e, urlStorage()))
  m2.attach()
  assert.deepEqual(names(m2.chain), ['card'], 'слой без содержимого считается закрытым сразу')

  // Запись истории НЕ правим: на холодном старте это падает у SvelteKit.
  // Метка глубины остаётся «3», и это намеренно — back() перешагнёт
  // через мёртвую запись, иначе первое закрытие не сработало бы.
  await Promise.resolve()
  const st = (e._stack[e._i()].state as any).modals
  assert.equal(st.depth, 2, 'метка глубины помнит мёртвую запись')

  // и закрытие всё равно доводит до нужного состояния
  m2.close()
  assert.deepEqual(names(m2.chain), [], 'закрылось с первого раза')
})

/* ── reconfigure: смена источников без пересоздания ядра ──────────── */

test('reconfigure: тот же набор — ничего не делаем (идемпотентность)', () => {
  const url = urlStorage()
  const mem = memoryStorage()
  const core = buildCore(historyEngine(), { url, memory: mem })
  let hits = 0
  core.subscribe?.(() => (hits += 1))

  core.reconfigure({ sources: { url, memory: mem } })
  assert.equal(hits, 0, 'повторный тот же конфиг не должен уведомлять')
})

test('reconfigure: убираем источник — ядро то же, записи оставшихся целы', () => {
  const e = historyEngine()
  const core = buildCore(e, { url: urlStorage(), memory: memoryStorage() })
  const m = createModals(core)
  m.attach()

  m.open('card', { params: { id: 7 } })
  assert.deepEqual(names(m.chain), ['card'])

  const before = m.core
  core.reconfigure({ sources: { url: urlStorage() } })

  assert.equal(m.core, before, 'ядро обязано остаться тем же объектом')
  assert.deepEqual(names(m.chain), ['card'], 'адресуемая запись пережила смену набора')
  assert.equal(core.name, 'history(url)', 'имя пересчитывается по новому набору')
})

test('reconfigure: адресуемость появляется и исчезает вместе с методом', () => {
  const core = buildCore(historyEngine(), { local: localStorageChain(fakeStorage()) })
  assert.equal(core.capabilities.addressable, false)
  assert.equal(core.hrefFor, undefined, 'без адреса метода быть не должно')

  core.reconfigure({ sources: { url: urlStorage(), local: localStorageChain(fakeStorage()) } })
  assert.equal(core.capabilities.addressable, true)
  assert.equal(typeof core.hrefFor, 'function', 'адрес появился — появился и метод')

  core.reconfigure({ sources: { local: localStorageChain(fakeStorage()) } })
  assert.equal(core.capabilities.addressable, false)
  assert.equal(core.hrefFor, undefined, 'адрес исчез — метод обязан исчезнуть')
})

test('reconfigure: смена lookup меняет разрешение имён на том же ядре', () => {
  const defA = { name: 'card', source: 'memory' } as any
  const core = buildCore(historyEngine(), { url: urlStorage(), memory: memoryStorage() }, {
    lookup: () => undefined,
  })
  assert.equal(core.lookup('card'), undefined)

  core.reconfigure({ lookup: (n: string) => (n === 'card' ? defA : undefined) })
  assert.equal(core.lookup('card'), defA, 'новый lookup виден через то же ядро')
})

test('reconfigure: запись исчезнувшего источника переселяется, а не пропадает', () => {
  const e = historyEngine()
  const core = buildCore(e, { url: urlStorage(), memory: memoryStorage() }, {
    lookup: (n: string) => (n === 'note' ? ({ name: 'note', source: 'memory' } as any) : undefined),
  })
  const m = createModals(core)
  m.attach()
  m.open('note')
  assert.deepEqual(names(m.chain), ['note'], 'запись легла в memory')

  core.reconfigure({ sources: { url: urlStorage() } })
  assert.deepEqual(names(m.chain), ['note'], 'молчаливая пропажа недопустима — запись обязана уцелеть')
  // `source` — деталь хранения, стор её не держит: спрашиваем ядро.
  assert.equal((core.read()[0] as RegisteredEntry).source, 'url', 'новый дом — оставшийся источник')
})

test('reconfigure: orphans=close выбрасывает запись осознанно', () => {
  const core = buildCore(historyEngine(), { url: urlStorage(), memory: memoryStorage() }, {
    lookup: (n: string) => (n === 'note' ? ({ name: 'note', source: 'memory' } as any) : undefined),
  })
  const m = createModals(core)
  m.attach()
  m.open('note')
  assert.deepEqual(names(m.chain), ['note'])

  core.reconfigure({ sources: { url: urlStorage() }, orphans: 'close' })
  assert.deepEqual(names(m.chain), [], 'явная политика close выбрасывает запись')
})

test('reconfigure: уцелевшие записи не трогаются при переселении соседа', () => {
  const core = buildCore(historyEngine(), { url: urlStorage(), memory: memoryStorage() }, {
    lookup: (n: string) =>
      n === 'note' ? ({ name: 'note', source: 'memory' } as any)
      : n === 'card' ? ({ name: 'card', source: 'url' } as any)
      : undefined,
  })
  const m = createModals(core)
  m.attach()
  m.open('card')
  m.open('note')
  assert.deepEqual(names(m.chain), ['card', 'note'])

  core.reconfigure({ sources: { url: urlStorage() } })
  assert.deepEqual(names(m.chain), ['card', 'note'], 'порядок стопки сохранён')
  const homes = core.read().map((e) => (e as RegisteredEntry).source)
  assert.deepEqual(homes, ['url', 'url'], 'переселён осиротевший, сосед остался на месте')
})

/* ── headless: запись цепочки без собственного DOM ────────────────── */

test('headless: участвует в цепочке, но содержимого не отдаёт', () => {
  const m = createModals(buildCore(historyEngine(), urlStorage()))
  m.attach()
  const id = m.openHeadless()

  assert.equal(m.chain.length, 1, 'headless обязана быть записью цепочки')
  assert.equal(m.chain[0].kind, 'transient')
  assert.equal(m.chain[0].overrides.headless, true, 'метка должна быть видна хосту')
  assert.equal(m.layerContent(id), undefined, 'содержимого у headless нет')
})

test('headless: не считается осиротевшей и не умирает сразу', () => {
  const m = createModals(buildCore(historyEngine(), urlStorage()))
  m.attach()
  m.openHeadless()
  // Разовый слой без содержимого отсеивается как мёртвый (см. aliveOnly).
  // headless содержимого не имеет ПО ПРИРОДЕ и обязана это пережить.
  assert.equal(m.chain.length, 1, 'headless отсеялась как осиротевший слой')
})

test('headless: закрывается обычным close и переживает соседей', () => {
  const m = createModals(buildCore(historyEngine(), urlStorage()))
  m.attach()
  m.open('card')
  m.openHeadless()
  assert.deepEqual(m.chain.map((e) => e.kind), ['registered', 'transient'])

  m.close()
  assert.deepEqual(names(m.chain), ['card'], 'close снял именно headless')
  m.close()
  assert.deepEqual(names(m.chain), [])
})

test('headless: overrides передаются (например mobile-направление)', () => {
  const m = createModals(buildCore(historyEngine(), urlStorage()))
  m.attach()
  m.openHeadless({ mobile: 'bottom', lock: true })
  assert.equal(m.chain[0].overrides.mobile, 'bottom')
  assert.equal(m.chain[0].overrides.lock, true)
  assert.equal(m.chain[0].overrides.headless, true)
})

test('содержимое снятых слоёв освобождается, headless — сразу (ISSUES.md R-09)', () => {
  const m = createModals(buildCore(historyEngine(), urlStorage()))
  m.attach()

  // Содержимое живёт до СЛЕДУЮЩЕЙ смены цепочки: пока играет анимация
  // выхода, хост читает layerContent у уходящего слоя, а `noForward`
  // опознаёт запись как живую по наличию в карте.
  const first = m.openLayer({ content: 'первый' })
  m.close()
  assert.equal(m.layerContent(first), 'первый', 'отпустили слишком рано — выход мигнул бы пустотой')

  const second = m.openLayer({ content: 'второй' })
  assert.equal(m.layerContent(first), undefined, 'содержимое закрытого слоя осталось в памяти')
  assert.equal(m.layerContent(second), 'второй')
})

test('«Вперёд» не стирает содержимое вернувшегося слоя (разбор ИИ, механизм 3)', () => {
  const engine = historyEngine()
  const m = createModals(buildCore(engine, urlStorage()))
  m.attach()

  const id = m.openLayer({ content: 'живое содержимое' })
  m.close()
  assert.equal(m.chain.length, 0)

  // «Вперёд»: запись возвращается в цепочку — содержимое обязано вернуться
  // вместе с ней, иначе слой окажется пустой оболочкой.
  engine.go(1)
  assert.equal(names(m.chain).length, 1, 'запись не вернулась после «Вперёд»')
  assert.equal(m.layerContent(id), 'живое содержимое', 'содержимое вернувшегося слоя стёрто')
})

test('зарегистрированная запись снимает системный оверлей, а не ложится под него', () => {
  const m = createModals(buildCore(historyEngine(), urlStorage()))
  m.attach()

  m.openHeadless({ mobile: 'bottom' })
  assert.equal(m.chain.length, 1)

  // Без снятия это нарушило бы «transient только на вершине»: write бросал
  // исключение, адрес не писался, модалка терялась после перезагрузки.
  assert.doesNotThrow(() => m.open('card', { params: { id: 7 } }))
  assert.deepEqual(names(m.chain), ['card'], 'оверлей не уступил место модалке')
})
