import { DbFailure } from "../errors";
import { createRequestContext, type DbHandle, type MinimalEvent, type Principal, type ResolvePrincipal } from "./context";
import type { Database } from "../types";

export interface DbHandleOptions {
  /**
   * Синглтон процесса (pool/PGlite) — так рекомендует SvelteKit (FAQ
   * «How do I set up a database?»); для «клиент на запрос» (Cloudflare
   * Hyperdrive) передают фабрику, чтобы не держать пул на isolate.
   */
  db: Database | ((event: MinimalEvent) => Database | Promise<Database>);
  /** Доверенный источник principal. `undefined` = гость (roles: []). */
  principal: ResolvePrincipal;
  /**
   * Разрешить DB-контекст только для этих префиксов — чтобы модалки/статика
   * не платили за резолв сессии. По умолчанию: все запросы.
   */
  paths?: readonly string[];
}

const guest: Principal = { roles: [] };

export function dbHandle(options: DbHandleOptions): DbHandle {
  if (!options.db || typeof options.principal !== "function")
    throw new Error("dbHandle requires { db, principal }");
  const paths = options.paths;
  return async ({ event, resolve }) => {
    if (paths && !paths.some((p) => event.url.pathname === p || event.url.pathname.startsWith(p))) {
      event.locals.dbCtx = createRequestContext(event, guest);
      return resolve(event);
    }
    const principal = (await options.principal(event)) ?? guest;
    if (!Array.isArray(principal.roles) || principal.roles.some((r) => typeof r !== "string"))
      throw new DbFailure("forbidden");
    event.locals.db =
      typeof options.db === "function" ? await options.db(event) : options.db;
    event.locals.dbCtx = createRequestContext(event, principal);
    return resolve(event);
  };
}
