/**
 * Транспорт для перенесённого теста «REST uses same API, strict DTO, …».
 * ЖИВЁТ ТОЛЬКО В ТЕСТАХ: в пакете REST-поверхности нет (решение владельца —
 * слой `hooks/locals`, не `/api/*`). Проверяет она ровно то, что пакет даёт:
 * `parseListInput`, `readJson` с лимитом тела и `toKitError`.
 */
import { DbFailure } from"../../errors";
import { toKitError } from"../../sveltekit/errors";
import { parseListInput, readJson } from"../../sveltekit/query";
import type { DataContext } from"../../types";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

export function createProbeRest<Api extends Record<string, any>>(
  api: Api,
  resolveContext: (request: Request) => DataContext | Promise<DataContext>,
  options: { maxBodyBytes?: number } = {},
) {
  async function route(request: Request): Promise<Response> {
    try {
      const ctx = await resolveContext(request);
      const url = new URL(request.url);
      const name = url.pathname.split("/").filter(Boolean)[0] ?? "";
      const tail = url.pathname.split("/").filter(Boolean).slice(1);
      const resource = api[name];
      if (!resource) throw new DbFailure("not_found");
      const id = tail[0];
      if (request.method === "GET" && !tail.length)
        return json({ items: await resource.select(ctx, parseListInput(url.searchParams)) });
      if (request.method === "GET" && tail[0] === "cursor")
        return json(await resource.cursor(ctx, parseListInput(url.searchParams, { cursor: true })));
      if (request.method === "GET" && tail[0] === "count")
        return json({ count: await resource.count(ctx, parseListInput(url.searchParams)) });
      if (request.method === "GET")
        return json(await resource.get(ctx, id, parseListInput(url.searchParams)));
      if (request.method === "POST" && !id)
        return json(
          await resource.insert(ctx, await readJson(request, { maxBytes: options.maxBodyBytes ?? 65536 })),
          201,
        );
      if (request.method === "PATCH")
        return json(
          await resource.update(ctx, id, await readJson(request, { maxBytes: options.maxBodyBytes ?? 65536 })),
        );
      if (request.method === "DELETE") return json(await resource.delete(ctx, id));
      throw new DbFailure("unsupported");
    } catch (error) {
      const { status, body } = toKitError(error);
      return json(body, status);
    }
  }
  // Hono принимал относительный путь; веб-стандартный Request — нет.
  return {
    request: (url: string, init?: RequestInit) =>
      route(new Request(url.startsWith("http") ? url : "http://probe.local" + url, init)),
  };
}
