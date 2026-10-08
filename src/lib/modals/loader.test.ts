import { test } from 'vitest'
import assert from 'node:assert/strict'
import { createLoader } from './loader'
import { createModalStore } from './store'
import { createRegistry } from './registry'
import type { ResolvedEntry } from './types'

const entry = (name: string, params: Record<string, unknown> = {}, index = 0): ResolvedEntry => ({
  name, index, params, size: { width: 480 }, color: '#fff', tailColor: '#eee',
  lock: false, noForward: false, known: true,
})
const tick = () => new Promise((r) => setTimeout(r, 0))

test('без загрузчика запись сразу готова', () => {
  const store = createModalStore()
  const scope = createRegistry('t').define([{ name: 'plain', component: 'X' } as any])
  const l = createLoader({ store, lookup: scope.lookup })
  l.runLoader(entry('plain'))
  assert.equal(l.readRuntime('plain', 0).status, 'ready')
})

test('незнакомое имя — ошибка с объяснением', () => {
  const store = createModalStore()
  const l = createLoader({ store, lookup: () => undefined })
  l.runLoader({ ...entry('ghost'), known: false })
  const rt = l.readRuntime('ghost', 0)
  assert.equal(rt.status, 'error')
  assert.match(rt.error!, /Нет такой модалки/)
})

test('загрузчик: loading → ready, данные попадают в состояние', async () => {
  const store = createModalStore()
  const scope = createRegistry('t').define([
    { name: 'card', component: 'X', loader: async () => ({ title: 'Привет' }) } as any,
  ])
  const l = createLoader({ store, lookup: scope.lookup })
  l.runLoader(entry('card', { id: 1 }))
  assert.equal(l.readRuntime('card', 0).status, 'loading')
  await tick()
  const rt = l.readRuntime('card', 0)
  assert.equal(rt.status, 'ready')
  assert.deepEqual(rt.data, { title: 'Привет' })
})

test('падение загрузчика — статус error с сообщением', async () => {
  const store = createModalStore()
  const scope = createRegistry('t').define([
    { name: 'bad', component: 'X', loader: async () => { throw new Error('сервер лёг') } } as any,
  ])
  const l = createLoader({ store, lookup: scope.lookup })
  l.runLoader(entry('bad'))
  await tick()
  assert.equal(l.readRuntime('bad', 0).status, 'error')
  assert.equal(l.readRuntime('bad', 0).error, 'сервер лёг')
})

test('кеш: повторное открытие не грузит заново', async () => {
  let calls = 0
  const store = createModalStore()
  const scope = createRegistry('t').define([
    { name: 'c', component: 'X', loader: async () => { calls++; return calls } } as any,
  ])
  const l = createLoader({ store, lookup: scope.lookup })
  l.runLoader(entry('c', { id: 1 })); await tick()
  l.runLoader(entry('c', { id: 1 })); await tick()
  assert.equal(calls, 1, 'второй раз — из кеша')
  l.runLoader(entry('c', { id: 2 })); await tick()
  assert.equal(calls, 2, 'другие параметры — другая загрузка')
})

test('дедупликация: две записи с одинаковыми параметрами ждут одну загрузку', async () => {
  let calls = 0
  const store = createModalStore()
  const scope = createRegistry('t').define([
    { name: 'c', component: 'X', loader: async () => { calls++; return 'данные' } } as any,
  ])
  const l = createLoader({ store, lookup: scope.lookup })
  l.runLoader(entry('c', { id: 1 }, 0))
  l.runLoader(entry('c', { id: 1 }, 1))
  await tick()
  assert.equal(calls, 1)
  assert.equal(l.readRuntime('c', 0).data, 'данные')
  assert.equal(l.readRuntime('c', 1).data, 'данные', 'вторая подписалась на ту же')
})

test('уход последнего подписчика отменяет загрузку', async () => {
  let aborted = false
  const store = createModalStore()
  const scope = createRegistry('t').define([
    { name: 'c', component: 'X',
      loader: (_p: any, signal: AbortSignal) => new Promise((_res, rej) => {
        signal.addEventListener('abort', () => { aborted = true; rej(new Error('отменено')) })
      }) } as any,
  ])
  const l = createLoader({ store, lookup: scope.lookup })
  const off = l.runLoader(entry('c'))
  assert.equal(l.readRuntime('c', 0).status, 'loading')
  off()
  await tick()
  assert.equal(aborted, true, 'сигнал отмены дошёл')
  assert.equal(l.readRuntime('c', 0).status, 'idle', 'состояние вернулось в исходное')
})

test('🎯 preload маршрута заменяет собственный loader', async () => {
  const store = createModalStore()
  const scope = createRegistry('t').define([
    // loader НЕ задан — данные должен взять загрузчик маршрута
    { name: 'account', component: 'X', route: (p: any) => `/account/${p.id}` } as any,
  ])
  let asked = ''
  const l = createLoader({
    store,
    lookup: scope.lookup,
    hrefOf: (e) => `/account/${e.params.id}`,
    preload: async (href) => { asked = href; return { ok: true, data: { name: 'Аня' } } },
  })
  l.runLoader(entry('account', { id: 42 }))
  await tick()
  assert.equal(asked, '/account/42', 'спросили загрузчик маршрута')
  assert.deepEqual(l.readRuntime('account', 0).data, { name: 'Аня' })
})

test('свой loader важнее маршрута, если задан', async () => {
  const store = createModalStore()
  const scope = createRegistry('t').define([
    { name: 'a', component: 'X', route: () => '/a', loader: async () => 'своё' } as any,
  ])
  let preloadCalled = false
  const l = createLoader({
    store, lookup: scope.lookup, hrefOf: () => '/a',
    preload: async () => { preloadCalled = true; return { ok: true, data: 'маршрут' } },
  })
  l.runLoader(entry('a')); await tick()
  assert.equal(l.readRuntime('a', 0).data, 'своё')
  assert.equal(preloadCalled, false)
})

test('preloadModal кеширует — открытие будет мгновенным', async () => {
  let calls = 0
  const store = createModalStore()
  const scope = createRegistry('t').define([
    { name: 'c', component: 'X', defaultParams: { tab: 'a' },
      loader: async () => { calls++; return 'ok' } } as any,
  ])
  const l = createLoader({ store, lookup: scope.lookup })
  assert.deepEqual(await l.preloadModal('c', { id: 1 }), { ok: true })
  assert.equal(calls, 1)
  // те же слитые параметры → runLoader берёт из кеша
  l.runLoader(entry('c', { tab: 'a', id: 1 }))
  assert.equal(l.readRuntime('c', 0).status, 'ready')
  assert.equal(calls, 1, 'повторной загрузки не было')
})

test('preloadModal: нет модалки и упавший загрузчик', async () => {
  const store = createModalStore()
  const scope = createRegistry('t').define([
    { name: 'bad', component: 'X', loader: async () => { throw new Error('нет сети') } } as any,
  ])
  const l = createLoader({ store, lookup: scope.lookup })
  const miss = await l.preloadModal('ghost', {})
  assert.equal(miss.ok, false)
  assert.match((miss as any).error, /Нет такой модалки/)
  const fail = await l.preloadModal('bad', {})
  assert.equal(fail.ok, false)
  assert.equal((fail as any).error, 'нет сети')
})

test('clearMemory сбрасывает кеш загрузчика', async () => {
  let calls = 0
  const store = createModalStore()
  const scope = createRegistry('t').define([
    { name: 'c', component: 'X', loader: async () => { calls++; return 'x' } } as any,
  ])
  const l = createLoader({ store, lookup: scope.lookup })
  await l.preloadModal('c', {})
  store.clearMemory()
  await l.preloadModal('c', {})
  assert.equal(calls, 2, 'после очистки грузим заново')
})

test('clearLoaderCache по имени и параметрам', async () => {
  let calls = 0
  const store = createModalStore()
  const scope = createRegistry('t').define([
    { name: 'a', component: 'X', loader: async () => { calls++; return 1 } } as any,
    { name: 'b', component: 'X', loader: async () => { calls++; return 2 } } as any,
  ])
  const l = createLoader({ store, lookup: scope.lookup })
  await l.preloadModal('a', { id: 1 }); await l.preloadModal('a', { id: 2 }); await l.preloadModal('b', {})
  assert.equal(calls, 3)
  l.clearLoaderCache('a', { id: 1 })
  await l.preloadModal('a', { id: 1 }); await l.preloadModal('a', { id: 2 }); await l.preloadModal('b', {})
  assert.equal(calls, 4, 'перегрузился только a:1')
})

test('LRU вытеснение с защитой активных записей (pinning)', async () => {
  let calls = 0
  const store = createModalStore()
  const scope = createRegistry('t').define([
    { name: 'item', component: 'X', loader: async (p: any) => { calls++; return p.id } } as any,
  ])
  // maxEntries = 2
  const l = createLoader({ store, lookup: scope.lookup, maxEntries: 2 })

  // Грузим 1 и 2
  await l.preloadModal('item', { id: 1 })
  await l.preloadModal('item', { id: 2 })
  assert.equal(calls, 2)

  // Делаем item:1 активной записью в цепочке
  store.set({ chain: [{ kind: 'registered', name: 'item', params: { id: 1 }, overrides: {} }] })

  // Грузим 3 -> должно вытеснить item:2 (поскольку 1 активна, хотя 1 старше 2)
  await l.preloadModal('item', { id: 3 })
  assert.equal(calls, 3)

  // item:1 всё ещё в кэше (защищена pinning)
  await l.preloadModal('item', { id: 1 })
  assert.equal(calls, 3, 'item:1 не вытеснена')

  // item:2 была вытеснена -> перезапрос
  await l.preloadModal('item', { id: 2 })
  assert.equal(calls, 4, 'item:2 была вытеснена и загрузилась заново')
})

test('Q1: report — неизвестная запись и сбой загрузчика летят в sink', async () => {
  const seen: any[] = []
  const store = createModalStore()
  const scope = createRegistry('q1').define([
    { name: 'bad', component: 'X', loader: async () => { throw new Error('nope') } },
  ] as never[])
  const l = createLoader({ store, lookup: scope.lookup, report: (e) => seen.push(e) })

  l.runLoader({ ...entry('ghost'), known: false })
  assert.equal(seen[0].lib, 'modals')
  assert.equal(seen[0].code, 'unknown-modal')
  assert.equal(seen[0].ctx.name, 'ghost')

  l.runLoader(entry('bad'))
  await tick()
  await tick()
  assert.equal(seen[1].code, 'load-failed')
  assert.equal((seen[1].cause as Error).message, 'nope')
  assert.equal(seen[1].ctx.name, 'bad')
})
