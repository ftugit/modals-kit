// F41: межписательская гонка адреса. Тест на ПУБЛИЧНЫХ точках, которые были и
// до исправления (`svelteKitRouter().syncAddress`, движок модалок, `shallowFlag`):
// `goto` подменён отложенным — запись применяется, только когда тест так решит,
// как в SvelteKit 3 (shallow-`goto` асинхронен, `page.*` меняется после
// разрешения маршрута). Проверяется ИТОГОВЫЙ адрес и состояние записи, а не
// число вызовов.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { claimQuery, resetQueryClaims } from './keys.js'

type GotoOpts = { shallow?: boolean; replace?: boolean; state?: Record<string, unknown>; reset?: boolean }
type Call = { url: string; opts: GotoOpts; apply: () => void; resolve: () => void; reject: (e: unknown) => void }

const calls: Call[] = []
const page: { url: URL; shallow: { url: URL } | null; state: Record<string, unknown> } = {
  url: new URL('http://app.test/films'),
  shallow: null,
  state: {},
}

const goto = vi.fn((url: string, opts: GotoOpts = {}) => {
  let resolve!: () => void
  let reject!: (e: unknown) => void
  const p = new Promise<void>((res, rej) => ((resolve = res), (reject = rej)))
  calls.push({
    url,
    opts,
    resolve,
    reject,
    apply: () => {
      const next = new URL(url, page.url)
      if (opts.shallow) page.shallow = { url: next }
      else ((page.url = next), (page.shallow = null))
      page.state = opts.state ?? {}
    },
  })
  return p
})
vi.mock('$app/navigation', () => ({
  goto: (url: string, opts: GotoOpts) => goto(url, opts),
  preloadData: vi.fn(),
  // Роутер готов сразу: в тесте SvelteKit «уже запущен».
  afterNavigate: (fn: () => void) => fn(),
}))
const navigating: { to: { url: URL } | null; willUnload: boolean | null } = { to: null, willUnload: null }
vi.mock('$app/state', () => ({ page, navigating }))
vi.mock('$app/env', () => ({ browser: true }))

const popstate: Array<() => void> = []
const historyGo = vi.fn()
;(globalThis as Record<string, unknown>).window = {
  addEventListener: (type: string, fn: () => void) => {
    if (type === 'popstate') popstate.push(fn)
  },
  location: {
    hash: '',
    // Адресная строка (ход 100: писатель читает её в `popstate`) — видимый адрес.
    get href() {
      return (page.shallow?.url ?? page.url).href + this.hash
    },
  },
  history: { go: historyGo },
}
const win = (globalThis as unknown as { window: { location: { hash: string } } }).window

const { shallowFlag, linkTask, resolveHref } = await import('./sveltekit')
const { svelteKitRouter, currentSearch } = await import('#lib/paginate/sveltekit/router.js')
const { svelteKitEngine } = await import('#lib/modals/cores/sveltekit.js')

const tick = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}
/** Применить и завершить i-й `goto` — как это делает SvelteKit. */
const land = async (i: number) => {
  calls[i]!.apply()
  calls[i]!.resolve()
  await tick()
}
const visible = () => page.shallow?.url ?? page.url
const setPage = (search: (prev: Record<string, unknown>) => Record<string, unknown>) =>
  svelteKitRouter().syncAddress!({ search })

beforeEach(async () => {
  // Бронь ключей, как при живой загрузке приложения: адаптер пагинатора
  // бронирует `page`, ядро модалок — цепочку `modal` (при первом же `chainToSearch`).
  resetQueryClaims()
  claimQuery('paginate:page', 'page', 'page.*')
  claimQuery('modals', 'modal', 'modal.*')
  // Довести хвосты предыдущего теста, затем начать с чистой страницы.
  for (const c of calls) c.resolve()
  await tick()
  calls.length = 0
  goto.mockClear()
  historyGo.mockClear()
  page.url = new URL('http://app.test/films')
  page.shallow = null
  page.state = {}
  win.location.hash = ''
})

describe('F41: два владельца адреса, пока запись в полёте', () => {
  it('синхронизация пагинатора во время открытия модалки не теряет модалку', async () => {
    const modals = svelteKitEngine()
    modals.pushState('/films?modal=card', { modals: { depth: 1 } })
    setPage((prev) => ({ ...prev, page: 2 }))

    for (let i = 0; i < calls.length; i++) await land(i)

    expect(visible().searchParams.get('modal')).toBe('card')
    expect(visible().searchParams.get('page')).toBe('2')
    expect(page.state).toEqual({ modals: { depth: 1 } })
  })

  it('модалка во время синхронизации пагинатора не стирает его ключи', async () => {
    const modals = svelteKitEngine()
    setPage((prev) => ({ ...prev, page: 3 }))
    // Ядро модалок строит адрес от того, что видит движок, — как build.ts.
    const loc = modals.location()
    const params = new URLSearchParams(loc.search)
    params.set('modal', 'card')
    modals.pushState(`${loc.pathname}?${params}`, { ...modals.state(), modals: { depth: 1 } })

    for (let i = 0; i < calls.length; i++) await land(i)

    expect(visible().searchParams.get('page')).toBe('3')
    expect(visible().searchParams.get('modal')).toBe('card')
    expect(page.state).toEqual({ modals: { depth: 1 } })
  })

  it('флаг «мелкой» записи во время открытия модалки сохраняет её состояние', async () => {
    const modals = svelteKitEngine()
    modals.pushState('/films?modal=card', { modals: { depth: 1 } })
    shallowFlag('ddSidebar').push()

    for (let i = 0; i < calls.length; i++) await land(i)

    expect(page.state).toEqual({ modals: { depth: 1 }, ddSidebar: true })
    expect(visible().searchParams.get('modal')).toBe('card')
  })
})

describe('писатель: порядок и история', () => {
  it('в полёте не больше одного goto; две модалки подряд — два шага истории', async () => {
    const modals = svelteKitEngine()
    modals.pushState('/films?modal=a', { modals: { depth: 1 } })
    modals.pushState('/films?modal=a~b', { modals: { depth: 2 } })
    expect(goto).toHaveBeenCalledTimes(1)

    await land(0)
    expect(goto).toHaveBeenCalledTimes(2)
    expect(calls.map((c) => c.opts.replace)).toEqual([false, false])
    await land(1)
    expect(visible().search).toBe('?modal=a~b')
  })

  it('до применения движок видит своё, после — page.*', async () => {
    const modals = svelteKitEngine()
    modals.pushState('/films?modal=card', { modals: { depth: 1 } })
    expect(modals.location()).toEqual({ pathname: '/films', search: '?modal=card' })
    expect(modals.state()).toEqual({ modals: { depth: 1 } })
    expect(currentSearch()).toEqual({ modal: 'card' })

    await land(0)
    expect(modals.state()).toEqual(page.state)
    expect(modals.location().search).toBe('?modal=card')
  })

  it('без записей — видимый адрес: page.shallow приоритетнее page.url', () => {
    const modals = svelteKitEngine()
    expect(modals.location()).toEqual({ pathname: '/films', search: '' })
    page.shallow = { url: new URL('http://app.test/films?modal=x') }
    expect(modals.location()).toEqual({ pathname: '/films', search: '?modal=x' })
  })

  it('Назад во время полёта: очередь выброшена, видимым снова становится page.*', async () => {
    const modals = svelteKitEngine()
    modals.pushState('/films?modal=a', { modals: { depth: 1 } })
    setPage((prev) => ({ ...prev, page: 2 }))
    expect(goto).toHaveBeenCalledTimes(1)

    for (const fn of popstate) fn()
    expect(modals.location().search).toBe('')

    calls[0]!.resolve() // прерванная запись завершается без применения
    await tick()
    expect(goto).toHaveBeenCalledTimes(1)
  })

  it('шаг по истории ждёт запись, сделанную до него, и держит очередь до popstate', async () => {
    const modals = svelteKitEngine()
    modals.pushState('/films?modal=a', { modals: { depth: 1 } })
    modals.go!(-1)
    expect(historyGo).not.toHaveBeenCalled()

    await land(0)
    expect(historyGo).toHaveBeenCalledWith(-1)

    setPage((prev) => ({ ...prev, page: 2 }))
    expect(goto).toHaveBeenCalledTimes(1)
    for (const fn of popstate) fn()
    await tick()
    expect(goto).toHaveBeenCalledTimes(1)
  })

  it('#якорь берётся из адресной строки в момент отправки, а не записи', async () => {
    const modals = svelteKitEngine()
    modals.pushState('/films?modal=a', { modals: { depth: 1 } })
    setPage((prev) => ({ ...prev, page: 2 }))
    win.location.hash = '#later'
    await land(0)
    expect(calls[1]!.url).toBe('/films?modal=a&page=2#later')
  })

  it('отказ goto не глотается', async () => {
    const modals = svelteKitEngine()
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    modals.pushState('/nowhere', {})
    calls[0]!.reject(new Error('Not found'))
    await tick()
    await new Promise((r) => setTimeout(r, 0))
    process.off('unhandledRejection', unhandled)
    expect(unhandled).toHaveBeenCalledTimes(1)
  })
})

describe('писатель и обход ядра модалок', () => {
  it('пока свой шаг по истории не завершён, писатель сообщает «обход идёт»', async () => {
    const { addressTraversing } = await import('./sveltekit')
    const modals = svelteKitEngine()
    modals.pushState('/films?modal=a', { modals: { depth: 1 } })
    modals.go!(-1)
    expect(addressTraversing()).toBe(true) // go ждёт запись открытия
    await land(0) // запись открытия применилась — это ещё НЕ итог обхода
    expect(addressTraversing()).toBe(true)
    for (const fn of popstate) fn()
    expect(addressTraversing()).toBe(false)
  })
})

describe('linkTask: переход идёт именно на адрес ссылки (адаптер #lib/task)', () => {
  beforeEach(() => {
    page.url = new URL('http://app.test/films')
    page.shallow = null
    navigating.to = null
    navigating.willUnload = null
  })
  const go = (href: string, willUnload = false) => {
    navigating.to = { url: new URL(href, 'http://app.test') }
    navigating.willUnload = willUnload
  }

  it('перехода нет — покой у всех', () => {
    expect(linkTask('/paginator').status).toBe('idle')
  })

  it('совпадают путь и query — ожидание; якорь не в счёт', () => {
    go('/paginator?page.src=animes')
    expect(linkTask('/paginator?page.src=animes').status).toBe('pending')
    expect(linkTask('/paginator?page.src=animes#top').status).toBe('pending')
    expect(linkTask('/paginator').status).toBe('idle')
    expect(linkTask('/paginator?page.src=db').status).toBe('idle')
    expect(linkTask('/form').status).toBe('idle')
  })

  it('относительный адрес — от видимого адреса, в том числе после «мелкой» записи', () => {
    page.shallow = { url: new URL('http://app.test/modals') }
    go('/modals?modal=card')
    expect(linkTask('?modal=card').status).toBe('pending')
  })

  it('чужой origin, выгрузка документа, пустой href — покой', () => {
    go('/paginator')
    expect(linkTask('https://shikimori.io/paginator').status).toBe('idle')
    expect(linkTask(undefined).status).toBe('idle')
    expect(linkTask('').status).toBe('idle')
    go('/paginator', true)
    expect(linkTask('/paginator').status).toBe('idle')
  })
})

describe('resolveHref: куда ведёт ссылка (от видимого адреса)', () => {
  beforeEach(() => {
    page.url = new URL('http://app.test/cards/1')
    page.shallow = null
  })
  it('относительные адреса — от текущей страницы, не от корня', () => {
    expect(resolveHref('?modal=card')?.url.pathname).toBe('/cards/1')
    expect(resolveHref('2')?.url.pathname).toBe('/cards/2')
    expect(resolveHref('#top')?.url.pathname).toBe('/cards/1')
    page.shallow = { url: new URL('http://app.test/modals') }
    expect(resolveHref('?modal=card')?.url.pathname).toBe('/modals')
  })
  it('свой origin — local, чужой — нет; пусто — null', () => {
    expect(resolveHref('/form')?.local).toBe(true)
    expect(resolveHref('https://shikimori.io/x')?.local).toBe(false)
    expect(resolveHref('mailto:a@b.c')?.local).toBe(false)
    expect(resolveHref('')).toBeNull()
    expect(resolveHref(undefined)).toBeNull()
  })
})
