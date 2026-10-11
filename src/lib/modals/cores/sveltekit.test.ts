// Ядро SvelteKit: исход `preload` по контракту SvelteKit 3.
// `preloadData` в 3.x отдаёт `{ type: 'error', status, error }` при ошибке загрузчика
// (sveltejs/kit#12579); раньше такой исход маскировался под `loaded` (C4).
import { beforeEach, describe, expect, it, vi } from 'vitest'

const preloadData = vi.fn()
const goto = vi.fn()
vi.mock('$app/navigation', () => ({
  preloadData: (href: string) => preloadData(href),
  goto: (...args: unknown[]) => goto(...args),
}))
// Изменяемый срез `page`: тест сам «применяет» shallow-запись, как это делает роутер.
const page: { url: URL; shallow: { url: URL } | null; state: Record<string, unknown> } = {
  url: new URL('http://app.test/films'),
  shallow: null,
  state: {},
}
vi.mock('$app/state', () => ({ page }))
vi.mock('$app/env', () => ({ browser: false }))

const { svelteKitEngine } = await import('./sveltekit')
const preload = (href: string) => svelteKitEngine().preload!(href)

describe('svelteKitEngine().preload — исходы preloadData 3.x', () => {
  beforeEach(() => preloadData.mockReset())

  it('loaded 200 → данные маршрута', async () => {
    preloadData.mockResolvedValue({ type: 'loaded', status: 200, data: { id: 1 } })
    expect(await preload('/cards/1')).toEqual({ ok: true, data: { id: 1 } })
  })

  it('error 404 → not-found со статусом, а не «переадресация»', async () => {
    preloadData.mockResolvedValue({ type: 'error', status: 404, error: { message: 'Not Found' } })
    expect(await preload('/cards/404')).toEqual({ ok: false, reason: 'not-found', status: 404 })
  })

  it('error 500 → error со статусом', async () => {
    preloadData.mockResolvedValue({ type: 'error', status: 500, error: { message: 'boom' } })
    expect(await preload('/cards/500')).toEqual({ ok: false, reason: 'error', status: 500 })
  })

  it('redirect → redirect', async () => {
    preloadData.mockResolvedValue({ type: 'redirect', status: 303, location: '/login' })
    expect(await preload('/private')).toEqual({ ok: false, reason: 'redirect' })
  })
})

/**
 * В SvelteKit 3 shallow-`goto` асинхронен: `page.*` меняется только после
 * разрешения маршрута. Ядро пишет и сразу читает — движок обязан отдавать
 * собственную незавершённую запись, а после применения снова `page.*`.
 */
describe('svelteKitEngine — «читаю своё» поверх асинхронного goto', () => {
  type Deferred = { resolve: () => void; apply: () => void }
  let calls: Deferred[]

  beforeEach(() => {
    page.url = new URL('http://app.test/films')
    page.shallow = null
    page.state = {}
    calls = []
    goto.mockReset()
    goto.mockImplementation((url: string, opts: { state: Record<string, unknown> }) => {
      let resolve!: () => void
      const p = new Promise<void>((r) => (resolve = r))
      calls.push({
        resolve,
        apply: () => {
          page.shallow = { url: new URL(url, page.url) }
          page.state = opts.state
        },
      })
      return p
    })
  })

  it('до применения записи — записанное; после — page.shallow/page.state', async () => {
    const e = svelteKitEngine()
    e.pushState('/films?modal=card', { modals: { depth: 1 } })
    expect(goto).toHaveBeenCalledWith('/films?modal=card', {
      shallow: true,
      replace: false,
      state: { modals: { depth: 1 } },
    })
    expect(e.location()).toEqual({ pathname: '/films', search: '?modal=card' })
    expect(e.state()).toEqual({ modals: { depth: 1 } })

    calls[0].apply()
    calls[0].resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(e.location()).toEqual({ pathname: '/films', search: '?modal=card' })
    expect(e.state()).toBe(page.state)
  })

  it('две записи в полёте: применение первой не возвращает её состояние', async () => {
    const e = svelteKitEngine()
    e.pushState('/films?modal=card', { modals: { depth: 1 } })
    e.replaceState('/films?modal=card~user', { modals: { depth: 2 } })
    expect(goto.mock.calls[1][1]).toMatchObject({ shallow: true, replace: true })

    calls[0].apply()
    calls[0].resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(e.state()).toEqual({ modals: { depth: 2 } })
    expect(e.location().search).toBe('?modal=card~user')

    calls[1].apply()
    calls[1].resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(e.state()).toBe(page.state)
    expect(e.state()).toEqual({ modals: { depth: 2 } })
  })

  it('без записей — видимый адрес: page.shallow приоритетнее page.url', () => {
    const e = svelteKitEngine()
    expect(e.location()).toEqual({ pathname: '/films', search: '' })
    page.shallow = { url: new URL('http://app.test/films?modal=x') }
    expect(e.location()).toEqual({ pathname: '/films', search: '?modal=x' })
  })
})
