/**
 * Чистая логика автопродления — без рун и сети, проверяется тестами.
 * Правило владельца: выстрел ЗА 5% времени жизни, НЕ МЕНЕЕ 60 с; точка
 * выстрела — случайно внутри лид-окна (джиттер), чтобы вкладки не стреляли
 * разом. Гонку гасят: одноразовость токена продления + перечитывание куки
 * (сервер-арбитр) — таймер лишь уменьшает толпу.
 */

/** Лид-окно в миллисекундах: 5% срока жизни, но не меньше 60 с. */
export function leadFor(ttlMs: number): number {
  return Math.max(Math.round(ttlMs * 0.05), 60_000)
}

/**
 * Момент выстрела: конец лид-окна минус случайная доля окна. При часе TTL
 * окно 3 мин — вкладки стреляют в разные секунды третьей минуты.
 */
export function fireAt(expiresAtMs: number, ttlMs: number, rand: () => number = Math.random): number {
  const lead = leadFor(ttlMs)
  const jitter = Math.round(lead * rand())
  return expiresAtMs - lead + jitter
}

/** Пора ли продлевать при вызове api (страховка от заснувших таймеров вкладки). */
export function overdue(expiresAtMs: number, nowMs: number): boolean {
  return nowMs >= expiresAtMs - leadFor(60_000)
}

/**
 * Зеркало из ответа api: срок доступа. Каждый ответ несёт «твой доступ
 * истекает в T» — вкладка сверяет RAM с зеркалом и перечитывает куку, если
 * разошлись (кто-то продлил, сервер перезаписал куку).
 */
import { parse } from 'devalue'

export type AccessMirror = {
  /** Рам-копия временного токена (значение из ответа api). */
  access: string
  /** Когда истекает (мс от эпохи, серверное время). */
  expiresAt: number
  /** Срок жизни, из которого считан лид (мс). */
  ttlMs: number
}

/** Ответ экшена продления для vault: токен + срок (внутри `Result.data`). */
export type RenewData = AccessMirror & {
  /** Кто я (из access); для витрины профиля — `prof` отвечает api. */
  sub: string
  prof: { nickname: string | null; avatarUrl: string | null }
}

/** Достать данные продления из `ActionResult` экшена; нет — `undefined`. */

/**
 * Ответ form-action SvelteKit: `{type:'success'|'failure', data: devalue}`.
 * Возвращает `{result}` из него; не-упакованный ответ (свой API-эндпоинт)
 * проходит насквозь.
 */
export function unwrapKitAction(body: unknown): { result?: { ok?: boolean; data?: unknown } } | undefined {
  if (!body || typeof body !== 'object') return undefined
  const shaped = body as { type?: string; data?: unknown }
  if (shaped.type !== 'success' && shaped.type !== 'failure') {
    // не упаковано (свой API-эндпоинт): { data: { result } }
    const direct = (shaped as { data?: { result?: { ok?: boolean; data?: unknown } } }).data
    return direct && typeof direct === 'object' ? direct : undefined
  }
  try {
    // Kit кладёт в data уже сериализованную devalue-строку
    return parse(shaped.data as string) as { result?: { ok?: boolean; data?: unknown } }
  } catch {
    return undefined
  }
}

export function parseRenewResponse(body: unknown): RenewData | undefined {
  // ответ экшена Kit упаковывает по-своему ({type:'success', data: devalue-массив});
  // распаковка — общая с виджетом (unwrapKitAction)
  const unwrapped = unwrapKitAction(body)?.result
  if (!unwrapped || unwrapped.ok !== true) return undefined
  const data = unwrapped.data as Partial<RenewData> | undefined
  if (
    typeof data?.access !== 'string' ||
    typeof data?.expiresAt !== 'number' ||
    typeof data?.ttlMs !== 'number' ||
    typeof data?.sub !== 'string'
  )
    return undefined
  return {
    access: data.access,
    expiresAt: data.expiresAt,
    ttlMs: data.ttlMs,
    sub: data.sub,
    prof: data.prof ?? { nickname: null, avatarUrl: null },
  }
}
