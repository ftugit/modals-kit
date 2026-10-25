/**
 * `fetch` приложения для чужих сервисов — единственное место, где заданы их
 * правила: лимиты запусков, User-Agent, таймаут, повторы (`#lib/fetch`).
 * Транспорты получают его явно (`deps.fetch`, по умолчанию — этот), поэтому
 * лимит хоста общий у всех: REST и GraphQL Shikimori больше не ведут две
 * очереди к одному сайту.
 *
 * Глобальный `fetch` НЕ подменяется: `lib/db` ходит через него к прокси базы, и
 * повтор записи там недопустим.
 *
 * Нижний `fetch` берётся ОДИН раз — в хуке `init` (`captureUpstreamFetch`), до
 * любого рендера. Причина: в dev Kit на
 * время асинхронного SSR-рендера подменяет глобальный `fetch` предупреждающей
 * обёрткой, а запрос из очереди хоста может уйти во время рендера ЧУЖОЙ
 * страницы — Kit предупредил бы от её имени. Без `init` (тесты, утилиты) —
 * `globalThis.fetch` в момент вызова.
 */
import { createFetch, type AppFetch, type CreateFetchOptions, type FetchClock, type FetchWait } from '#lib/fetch/index.js'
import type { TaskState } from '#lib/task/index.js'
import { currentReport } from '#hooks/task-stream.server.js'

/** User-Agent обязателен: Shikimori отказывает запросам без него. */
export const UPSTREAM_UA = 'modals-kit-demo/0.1 (+https://github.com/ftugit/modals-kit)'

let captured: typeof globalThis.fetch | undefined

/** Запомнить настоящий `fetch`. Вызывать из `init` в `hooks.server.ts`. */
export function captureUpstreamFetch(fetchImpl: typeof globalThis.fetch = globalThis.fetch): void {
  captured = fetchImpl
}

const ua = { 'User-Agent': UPSTREAM_UA, accept: 'application/json' }

/**
 * Правила приложения поверх любого нижнего `fetch`. Отдельной функцией — чтобы
 * тесты транспортов проверяли ТЕ ЖЕ правила на поддельной сети и часах.
 */
export function makeUpstream(
  lower: CreateFetchOptions['fetch'] = (input, init) => (captured ?? globalThis.fetch)(input, init),
  clock?: Partial<FetchClock>,
): AppFetch {
  return createFetch({
    fetch: lower,
    timeoutMs: 10_000,
    retry: { attempts: 2, baseDelayMs: 500, maxDelayMs: 5_000 },
    hosts: {
      // https://shikimori.io/api/doc: «API access is limited by 5rps and 90rpm».
      // Запас на разброс сети: запросы, ушедшие с интервалом в секунду, могут
      // прийти чуть плотнее.
      'shikimori.io': { rps: 4, rpm: 80, headers: ua },
      // Лимит не опубликован; темп как был у GraphQL-транспорта (зазор 250 мс).
      'rickandmortyapi.com': { rps: 4, headers: ua },
    },
    ...(clock ? { clock } : {}),
  })
}

/** `fetch` приложения для чужих сервисов: один на процесс, лимиты общие. */
const base = makeUpstream()

/**
 * Ожидание вызова — словами для человека (полоса и строки хода, `task-stream.ts`).
 * Без процента: очередь и паузы не измеряются честно.
 */
export function waitTask(wait: FetchWait): Extract<TaskState, { status: 'pending' }> {
  const label =
    wait.reason === 'retry'
      ? `Повтор ${wait.attempt} из ${wait.attempts}`
      : wait.waitMs !== undefined
        ? `Очередь API: ~${Math.max(1, Math.ceil(wait.waitMs / 1000))} с`
        : `Очередь API: впереди ${wait.ahead}`
  return { status: 'pending', scope: 'local', label }
}

/**
 * Общий `fetch` к чужим сервисам. Внутри запроса со строками хода (`taskResponse`)
 * его ожидания — очередь лимита, повторы — уходят клиенту; вне его ничего не меняется.
 */
export const upstream: AppFetch = (input, init) => {
  const report = currentReport()
  if (!report || init?.onWait) return base(input, init)
  return base(input, { ...init, onWait: (wait) => report(waitTask(wait)) })
}
