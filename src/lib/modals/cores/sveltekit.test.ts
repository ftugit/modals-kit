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

// «Читаю своё» поверх асинхронного `goto` (запись → сразу чтение) теперь
// обеспечивает общий писатель адреса слоя роутера (F41); проверки — в
// `src/lib/router/sveltekit.test.ts` (там же — браузерный режим и гонки
// с пагинатором и флагами «мелких» записей).
