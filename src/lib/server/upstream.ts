/**
 * Общее для серверных транспортов к внешним API (REST Shikimori, GraphQL и
 * любые следующие) — без знания о конкретном сервисе: `fetch` для внешних
 * запросов и общий слой сетевых ошибок.
 *
 * `fetch` для внешних запросов берётся ОДИН раз — в хуке `init` сервера
 * (`hooks.server.ts`), до любого рендера. Причина (F8, `docs/design/kit3-upgrade.md`
 * §13.3): в dev SvelteKit на всё время асинхронного SSR-рендера подменяет
 * глобальный `fetch` предупреждающей обёрткой. Транспорт ставит запросы в
 * очередь с паузой, и запрос, рождённый `load` одной страницы, уходил во время
 * рендера другой — Kit предупреждал «fetch во время SSR» от её имени. Брать
 * `globalThis.fetch` при загрузке модуля нельзя: модуль грузится лениво, в том
 * числе посреди чужого рендера, и запомнил бы обёртку навсегда.
 *
 * Без `init` (тесты, утилиты) — `globalThis.fetch` в момент вызова, как раньше.
 */
let captured: typeof globalThis.fetch | undefined

/** Запомнить настоящий `fetch`. Вызывать из `init` в `hooks.server.ts`. */
export function captureUpstreamFetch(fetchImpl: typeof globalThis.fetch = globalThis.fetch): void {
  captured = fetchImpl
}

/** `fetch` для запросов к внешним API: запомненный в `init` или глобальный. */
export function upstreamFetch(): typeof globalThis.fetch {
  return captured ?? globalThis.fetch
}

/**
 * Сбой внешнего API — общий предок ошибок всех транспортов (§13.1,
 * `docs/design/kit3-upgrade.md`). Откуда сбой — видно по классу наследника
 * (`GraphqlUpstreamError`, `ShikimoriUpstreamError`, …): решения принимаются
 * через `instanceof`, а `name` задан строкой в каждом классе и нужен логу
 * (переживает минификацию, в отличие от `constructor.name`).
 *
 * `message` — НАШ текст (причина: код ответа, «недоступен»), его можно показать
 * клиенту; исходная ошибка (адрес, код ОС, тексты `errors` сервера) — только в
 * `cause`, для лога (B8).
 */
export class UpstreamError extends Error {
  status: number
  /**
   * @param message Текст для клиента — без адресов и подробностей.
   * @param status HTTP-статус ответа маршрута: 502 (ответил плохо) или 504 (не ответил).
   * @param options `cause` — исходная ошибка, только для лога.
   */
  constructor(message: string, status = 502, options?: ErrorOptions) {
    super(message, options)
    this.name = 'UpstreamError'
    this.status = status
  }
}

/**
 * Единственное место, где пойманная ошибка становится ответом API-маршрута (B8).
 * Сбой внешнего API (любой наследник `UpstreamError`) отдаёт свой текст-причину
 * и код; всё прочее (в том числе `HttpError` Kit и ошибки нашего кода) —
 * непредвиденный сбой сервера: подробности только в лог, клиенту — общий текст.
 * Обрыв запроса клиентом не логируется: читать ответ уже некому. Что именно не
 * удалось («схема фильтров недоступна») дописывает маршрут — это его контекст.
 * @param error Пойманная ошибка.
 * @param where Метка маршрута для лога.
 * @returns Текст-причина для клиента и HTTP-статус.
 */
export function upstreamFailure(error: unknown, where: string): { message: string; status: number } {
  if (error instanceof UpstreamError) {
    if (error.cause !== undefined) console.warn(`[${where}] ${error.name}: ${error.message}`, error.cause)
    return { message: error.message, status: error.status }
  }
  if (!(error instanceof Error && error.name === 'AbortError')) console.error(`[${where}]`, error)
  return { message: 'внутренняя ошибка сервера', status: 502 }
}
