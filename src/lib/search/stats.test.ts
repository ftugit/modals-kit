/**
 * Unit-набор ОБЩЕГО канала статистики перехвата (`./stats`).
 *
 * Зачем отдельно от `search.test.ts`: канал — не часть ядра поиска, а слой
 * связи поиска с UI (панель подписывается хуком `useSearchStats`, потребитель
 * может слушать `onSearchStats`). Здесь пинится именно связь: кто публикует
 * (декоратор `withLibSearch` со своим `name`), что видят подписчики и где
 * перехват заведомо не исполняется (серверная подстрока — статистики нет).
 *
 * Живые числа (скан/совпадения/выдача) — в браузерных сценариях: в node
 * fuzzy-контур по архитектуре не запускается (`isServerSide()`).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { defineSource, type AdaptedSource, type Extra, type PageRequest } from '../paginate'
import { withLibSearch } from './accumulator'
import type { SearchInterceptStats } from './accumulator'
import { getSearchStats, onSearchStats, reportSearchStats, resetSearchStats } from './stats'

type Rec = { id: string; title: string }

/** Источник теста: объявлены и поиск, и разрешение сканирования (иначе `withLibSearch` откажет). */
function scanSource(calls: PageRequest[] = []): AdaptedSource<Rec> {
  return defineSource<Rec>({
    name: 'stats-source',
    record: { id: (r) => r.id, title: (r) => r.title, texts: (r) => [r.title] },
    scan: { batchSize: 50 },
    search: { minLength: 1 },
    data: async (look, input) => {
      calls.push({
        page: look.page,
        pageSize: look.pageSize,
        signal: look.signal,
        extra: { q: input.q, ...input.filters },
      })
      return { items: [{ id: '1', title: `запрос: ${input.q ?? '—'}` }], hasNext: false }
    },
  })
}

const sample: SearchInterceptStats = {
  scanned: 50,
  matched: 16,
  emitted: 5,
  sourcePage: 2,
  exhausted: false,
}

afterEach(() => {
  resetSearchStats()
})

describe('канал статистики перехвата', () => {
  it('report → get, подписка отдаёт текущее значение сразу и снимается', () => {
    expect(getSearchStats('panel')).toBeNull()

    const seen: (SearchInterceptStats | null)[] = []
    const off = onSearchStats('panel', (next) => seen.push(next))
    expect(seen).toEqual([null]) // сразу текущее — «первых» чисел панель не ждёт

    reportSearchStats('panel', sample)
    expect(seen).toEqual([null, sample])
    expect(getSearchStats('panel')).toEqual(sample)

    off()
    reportSearchStats('panel', null)
    expect(seen).toEqual([null, sample]) // после отписки слушателя нет
    expect(getSearchStats('panel')).toBeNull()
  })

  it('resetSearchStats: канал пуст для всех имён', () => {
    reportSearchStats('a', sample)
    reportSearchStats('b', sample)
    resetSearchStats()
    expect(getSearchStats('a')).toBeNull()
    expect(getSearchStats('b')).toBeNull()
  })

  it('декоратор с `name` публикует в канал: пустой запрос = перехват не в цепочке', async () => {
    const source = withLibSearch(scanSource(), { name: 'panel' })
    // Числа прошлого активного перехвата: их обязана вытеснить честная «пустота».
    reportSearchStats('panel', sample)
    const seen: (SearchInterceptStats | null)[] = []
    onSearchStats('panel', (next) => seen.push(next))

    await source.fetchPage({ page: 1, pageSize: 10 }, { q: '' })
    expect(seen).toEqual([sample, null]) // подписка отдала текущее, запрос погасил счётчики
    expect(getSearchStats('panel')).toBeNull()
  })

  it('тумблер `gate` гасит и перехват, и статистику — одинаково у канала и потребителя', async () => {
    const parity: (SearchInterceptStats | null)[] = []
    const source = withLibSearch(scanSource(), {
      name: 'gated',
      gate: 'ls',
      onStats: (next) => parity.push(next),
    })
    reportSearchStats('gated', sample)

    await source.fetchPage({ page: 1, pageSize: 10 }, { q: 'наруто', ls: false })
    expect(parity.at(-1)).toBeNull() // выключено тумблером
    expect(getSearchStats('gated')).toBeNull() // и канал гасит те же числа, а не молчит
  })

  it('серверный контур (SSR/no-JS) не выдаёт себя за перехват: статистика не публикуется', async () => {
    // В node `isServerSide()` истинно: запрос уходит базовому источнику как
    // серверная подстрока, накопительного контура нет — значит канал молчит.
    reportSearchStats('ssr', sample) // «старое» значение с прошлого клиента
    const calls: PageRequest[] = []
    const source = withLibSearch(scanSource(calls), { name: 'ssr' })
    const res = await source.fetchPage({ page: 1, pageSize: 10 }, { q: 'наруто' } as Extra)

    expect(calls.length).toBe(1) // базовый источник отработал ровно один раз
    expect(res.items[0]?.title).toBe('запрос: наруто')
    expect(getSearchStats('ssr')).toEqual(sample) // канал не переписан «пустотой»
  })
})
