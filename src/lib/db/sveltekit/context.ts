import type { DataContext, Database } from "../types";

/**
 * Структурные типы вместо `import type { Handle, RequestEvent } from '@sveltejs/kit'`:
 * пакет остаётся проверяемым без установленного SvelteKit, а его формы
 * совпадают с kit-типизацией (Handle = ({event, resolve}) => Promise<Response>),
 * поэтому `export const handle = dbHandle(...)` в `hooks.server.ts` проходит
 * `svelte-check` без приведений.
 */
export interface MinimalEvent {
  readonly request: Request;
  readonly url: URL;
  /**
   * `Record<string, any>` намеренно: у SvelteKit `event.locals` — это
   * `App.Locals` (интерфейс без индексной сигнатуры), и более строгий тип
   * сделал бы `export const handle = dbHandle(...)` несовместимым с `Handle`.
   */
  locals: Record<string, any>;
  readonly params?: Record<string, string>;
  readonly platform?: unknown;
}
export interface ResolveInput {
  readonly event: MinimalEvent;
}
export type Principal = { readonly id?: string; readonly roles: readonly string[] };
export type ResolvePrincipal = (
  event: MinimalEvent,
) => Principal | undefined | Promise<Principal | undefined>;
export type DbHandle = (input: {
  event: MinimalEvent;
  resolve: (event: MinimalEvent, options?: unknown) => Promise<Response>;
}) => Promise<Response>;

const MAX_REQUEST_ID = 200;
/** Заголовочный trace-id клиентский: режем размер и переводим в контрольные символы. */
function requestId(request: Request): string {
  const incoming = request.headers.get("x-request-id");
  if (
    incoming &&
    incoming.length <= MAX_REQUEST_ID &&
    !/[\u0000-\u001f\u007f]/.test(incoming)
  )
    return incoming;
  return crypto.randomUUID();
}

/**
 * Единственное место, где рождается `DataContext`. Клиент не участвует:
 * `principal` даёт доверенный resolver (сессия/cookie/секрет), `signal` —
 * сам рантайм. Поэтому `roles` нельзя «доложить» телом запроса.
 */
export function createRequestContext(
  event: MinimalEvent,
  principal: Principal,
): DataContext {
  return Object.freeze({
    principal: Object.freeze({
      ...(typeof principal.id === "string" && principal.id ? { id: principal.id } : {}),
      roles: Object.freeze([...(principal.roles ?? [])]),
    }),
    requestId: requestId(event.request),
    signal: event.request.signal,
  });
}

export interface LocalsDb {
  /** Запросо-независимый фасад: `db.query/transaction/resource`. */
  db: Database;
  /** Доверенный контекст этого запроса (principal + requestId + signal). */
  dbCtx: DataContext;
}
