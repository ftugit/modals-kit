/**
 * Живая выдача демо: опрос ТЕКУЩЕГО окна с условным `GET`.
 *
 * Почему опрос, а не push: на серверлесс-платформах долгоживущее соединение —
 * не данные, а обязательство (Vercel держит WebSocket в public beta и только с
 * Fluid Compute, CF Durable Objects — платный инстанс под каждый чат, Supabase
 * Realtime — отдельный продукт). Демо обязано остаться честным на `preview` и
 * на бесплатном хостинге, а 2-секундный условный `GET` стоит 304 без тела и
 * ровно так же показывает «новые строки».
 *
 * Четыре правила, без которых опрос превращается в отказоустойчивость наоборот:
 *   • `If-None-Match` — «ничего нового» не должно читать базу;
 *   • незаходящих запросов: следующий тик не стартует, пока живой ответ;
 *   • на скрытой вкладке — пауза (см. `document.visibilityState`);
 *   • при ошибках — экспоненциальный backoff с `Retry-After`, сброс на успехе.
 *
 * Что делает «изменилось»: решение принимает СТРАНИЦА (`onFresh`), потому что
 * «переспросить окно» у пагинатора означают разное: в постраничном режиме это
 * `reset` на первую страницу, в курсорном — пересборка накопленных окон, и
 * убивать прокрутку пользователя без его согласия здесь не разрешено.
 */

/** Пауза = «пользователь не смотрит»: опрашивать незачем и нельзя. */
export function isHidden(doc?: Document): boolean {
  const current = doc ?? (typeof document === 'undefined' ? undefined : document)
  return current?.visibilityState === 'hidden'
}

/**
 * Задержка после `errors`-го подряд сбоя. 3 → 6 → 12 → 24 → 48 → 60 с и
 * стоит на потолке: «сервер лежит» не лечится чаще, чем раз в минуту, а
 * flood-ить его во время аварии — способ аварии помочь.
 */
export function backoffDelay(errors: number, intervalMs: number): number {
  if (errors <= 0) return intervalMs
  return Math.min(60_000, intervalMs * 2 ** Math.min(errors, 5))
}

/** `Retry-After` важнее нашей математики: сервер сказал — значит ждём столько. */
export function retryAfterMs(header: string | null, intervalMs: number): number | null {
  if (!header) return null
  const seconds = Number(header)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.max(intervalMs, Math.min(120_000, seconds * 1000))
  const at = Date.parse(header)
  if (Number.isNaN(at)) return null
  return Math.max(intervalMs, Math.min(120_000, at - Date.now()))
}

export type LiveHandle = {
  start: () => void
  stop: () => void
  running: () => boolean
  /** Счётчики наружу: по ним пробы проверяют паузу и backoff без подглядывания внутрь. */
  stats: () => { ticks: number; changed: number; errors: number; waitMs: number }
}

export function createLive(options: {
  /** `null` — опрашивать нечего (режим или страница, где окна нет). */
  url: () => string | null
  /** Данные изменились: страница решает, переспрашивать ли источник. */
  onFresh: () => void
  intervalMs?: number
  /** Один запрос не должен висеть вечно: висящий = сеть, а не «медленно». */
  timeoutMs?: number
  fetchImpl?: typeof fetch
}): LiveHandle {
  const intervalMs = options.intervalMs ?? 2_000
  const timeoutMs = options.timeoutMs ?? 8_000
  const doFetch: typeof fetch = options.fetchImpl ?? ((...args) => fetch(...args))

  let etag: string | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let inFlight = false
  let running = false
  let stopped = false
  let ticks = $state(0)
  let changedCount = $state(0)
  let errors = $state(0)
  let waitMs = $state(intervalMs)
  let onVisibility: (() => void) | null = null

  const clear = (): void => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  async function tick(): Promise<void> {
    if (!running) return
    clear()
    if (isHidden()) {
      // Пауза: тик откладывается до возврата вкладки (см. `onVisibility`).
      return
    }
    if (inFlight) {
      waitMs = intervalMs
      timer = setTimeout(() => void tick(), intervalMs)
      return
    }
    const url = options.url()
    if (!url) {
      waitMs = intervalMs
      timer = setTimeout(() => void tick(), intervalMs)
      return
    }
    inFlight = true
    ticks += 1
    const headers: Record<string, string> = {}
    if (etag) headers['if-none-match'] = etag
    let response: Response | null = null
    try {
      response = await doFetch(url, {
        headers,
        cache: 'no-store',
        // Висящий запрос — то же зло, что и незакрытый: он держит `inFlight` и
        // блокирует следующие тики.
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (response.status === 304) {
        errors = 0
        waitMs = intervalMs
      } else if (response.ok) {
        const next = response.headers.get('etag')
        errors = 0
        waitMs = intervalMs
        if (etag === null) {
          // Первая выдача — ЭТАЛОН сверки, а не «изменение»: иначе включение
          // опроса само по себе сбрасывало бы окно на первую страницу.
          etag = next
        } else if (next !== etag) {
          etag = next
          changedCount += 1
          options.onFresh()
        }
      } else throw new Error(`live: ${response.status}`)
    } catch {
      errors += 1
      // `Retry-After` читается ИЗ ответа сбоя: сервер в курсе своей аварии лучше
      // нашей оценки. Ответа нет вовсе (сеть) — считаем по своей шкале.
      waitMs = retryAfterMs(response?.headers.get('retry-after') ?? null, intervalMs)
        ?? backoffDelay(errors, intervalMs)
    } finally {
      inFlight = false
    }
    if (!running || stopped) return
    timer = setTimeout(() => void tick(), waitMs)
  }

  return {
    start() {
      if (running) return
      running = true
      stopped = false
      if (typeof document !== 'undefined') {
        onVisibility = () => {
          if (document.visibilityState === 'hidden') {
            clear()
            return
          }
          // Вернулись: не ждём остатка паузы, а спрашиваем сразу.
          if (running) {
            clear()
            timer = setTimeout(() => void tick(), 0)
          }
        }
        document.addEventListener('visibilitychange', onVisibility)
      }
      timer = setTimeout(() => void tick(), intervalMs)
    },
    stop() {
      running = false
      stopped = true
      clear()
      if (typeof document !== 'undefined' && onVisibility) {
        document.removeEventListener('visibilitychange', onVisibility)
        onVisibility = null
      }
    },
    running: () => running,
    stats: () => ({ ticks, changed: changedCount, errors, waitMs }),
  }
}
