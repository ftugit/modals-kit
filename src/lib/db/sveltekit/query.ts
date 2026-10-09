import { DbFailure } from "../errors";
import type { CursorInput, Filter, ListInput, Order } from "../types";

/** Отсечка тела до буферизации (в источнике делал Hono `bodyLimit`). */
export class BodyTooLarge extends Error {
  readonly name = "BodyTooLarge";
}

/**
 * Ограниченное чтение тела: поток отменяется на превышении, а не «сначала
 * всё в память». Возвращает текст либо undefined при пустом теле.
 */
export async function readBoundedBody(
  request: Request,
  maxBytes: number,
): Promise<string | undefined> {
  if (typeof maxBytes !== "number" || !Number.isSafeInteger(maxBytes) || maxBytes < 0)
    throw new Error("Invalid body limit");
  const body = request.body;
  if (!body) return undefined;
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      size += item.value.byteLength;
      if (size > maxBytes) {
        void reader.cancel().catch(() => {});
        throw new BodyTooLarge();
      }
      chunks.push(item.value);
    }
  } finally {
    reader.releaseLock();
  }
  if (!size) return undefined;
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}
export async function readJson(
  request: Request,
  { maxBytes = 65536 }: { maxBytes?: number } = {},
): Promise<unknown> {
  const text = await readBoundedBody(request, maxBytes);
  if (text === undefined) throw new DbFailure("validation");
  try {
    return JSON.parse(text);
  } catch {
    throw new DbFailure("validation");
  }
}

/** `?/action` из SvelteKit: одиночный сегмент без слэшей/пробелов. */
const ACTION_MARKER = /^\/[^/?#\s]+$/;

const LIST_KEYS = [
  "fields",
  "filter",
  "order",
  "page",
  "limit",
  "includeDeleted",
  "include",
  "after",
] as const;

/**
 * `URLSearchParams` → `ListInput` (deny-safe): неизвестный или повторяющийся
 * ключ, битый JSON, `?page=` рядом с курсором — отказ, а не «молча игнорируем».
 * В SolidHono это делал REST-слой (`probe/rest.ts#options`); здесь он
 * framework-нейтральный и пригоден и в `load`, и в `+server.ts`.
 */
export function parseListInput(
  params: URLSearchParams,
  options: { cursor?: boolean } = {},
): ListInput & CursorInput {
  const cursor = !!options.cursor;
  const out: Record<string, unknown> = {};
  let marker = false;
  for (const [key, value] of params) {
    // Маркер form action SvelteKit (`?/create`) прилетает в `event.url` на POST
    // и на каждом invalidation. Это не данные клиента, поэтому он разрешён
    // только в каноническом виде: один сегмент, пустое значение, один раз.
    // `?/create=1`, `?/a&/a`, `?/a/b` — отказ как с мусором.
    if (value === "" && ACTION_MARKER.test(key)) {
      if (marker) throw new DbFailure("validation", undefined, ["duplicate action marker"]);
      marker = true;
      continue;
    }
    const allowed =
      LIST_KEYS.includes(key as (typeof LIST_KEYS)[number]) &&
      (key !== "after" || cursor) &&
      (key !== "page" || !cursor);
    if (!allowed || Object.prototype.hasOwnProperty.call(out, key))
      throw new DbFailure("validation");
    try {
      if (key === "filter" || key === "order") out[key] = JSON.parse(value);
      else if (key === "page" || key === "limit") {
        if (!/^[1-9]\d{0,8}$/.test(value)) throw new Error();
        out[key] = Number(value);
      } else if (key === "includeDeleted") {
        if (value !== "true" && value !== "false") throw new Error();
        out[key] = value === "true";
      } else if (key === "fields" || key === "include") out[key] = value ? value.split(",") : [];
      else out[key] = value;
    } catch (e) {
      if (e instanceof DbFailure) throw e;
      throw new DbFailure("validation");
    }
  }
  assertShape(out);
  return out as ListInput & CursorInput;
}
/** Ранняя проверка формы: JSON из query обязан быть объектом/массивом ожидаемого вида. */
function assertShape(input: Record<string, unknown>): void {
  const filter = input.filter;
  if (filter !== undefined && typeof filter !== "boolean" && (!filter || typeof filter !== "object"))
    throw new DbFailure("validation");
  if (Array.isArray(filter)) throw new DbFailure("validation");
  const order = input.order;
  if (order !== undefined) {
    if (!Array.isArray(order)) throw new DbFailure("validation");
    for (const pair of order as unknown[])
      if (!Array.isArray(pair) || pair.length !== 2 || pair[1] !== "asc" && pair[1] !== "desc")
        throw new DbFailure("validation");
  }
}
export type { Filter, Order };
