/**
 * Работа после ответа: ответ уже ушёл, а начатое (прогрев кэша, сборка справочника)
 * должно доделаться, а не замёрзнуть вместе с функцией.
 *
 * Как это устроено у платформ:
 *   • Vercel — `waitUntil` из `@vercel/functions`. Среда кладёт в глобальную область
 *     хранилище текущего запроса (`Symbol.for('@vercel/request-context')`), `waitUntil`
 *     берёт оттуда регистратор и отдаёт ему промис: функцию не заморозят, пока он не
 *     завершится (предел — тот же таймаут функции). Вне Vercel хранилища нет, и вызов
 *     ничего не делает — отдельная проверка «мы на Vercel?» не нужна.
 *   • Cloudflare — `event.platform.context.waitUntil` (ExecutionContext воркера).
 *     Вызывается методом: оторванная от контекста функция бросает «Illegal invocation».
 *   • Node (adapter-node, `vite preview`) — процесс живёт и так: промис просто идёт.
 *
 * Ошибка задачи ловится здесь и пишется в лог: после ответа её некому показать, а
 * необработанный отказ промиса может уронить процесс.
 */
import { waitUntil } from '@vercel/functions'

/** То, что нужно от события запроса: только `platform` (у Cloudflare там `context`). */
export interface AfterResponseEvent {
  readonly platform?: unknown
}

interface WaitUntilContext {
  waitUntil(promise: Promise<unknown>): void
}

function cloudflareContext(platform: unknown): WaitUntilContext | undefined {
  const context = (platform as { context?: unknown } | undefined)?.context
  return typeof (context as WaitUntilContext | undefined)?.waitUntil === 'function'
    ? (context as WaitUntilContext)
    : undefined
}

/**
 * Доделать `task` после ответа. Возвращает тот же промис, но уже без отказа — его можно
 * не ждать (`afterResponse(...)` вместо `void ...`), а тесты могут дождаться.
 */
export function afterResponse(task: Promise<unknown>, event?: AfterResponseEvent): Promise<void> {
  const settled = task.then(
    () => undefined,
    (error: unknown) => {
      console.error('[afterResponse] задача после ответа упала:', error)
    },
  )
  const cloudflare = cloudflareContext(event?.platform)
  if (cloudflare) cloudflare.waitUntil(settled)
  else waitUntil(settled)
  return settled
}
