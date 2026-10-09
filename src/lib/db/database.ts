import { DbFailure, normalizeFailure } from "./errors";
import { resourceApi } from "./resource";
import type { CursorCodec, Database, Driver, Limits } from "./types";
export interface DbOptions {
  driver: Driver;
  limits: Limits;
  cursorCodec?: CursorCodec;
  /** Максимальное ожидание observer; сам callback не отменяется. Default 100ms. */
  observerTimeoutMs?: number;
  onError?: (failure: DbFailure) => void | Promise<void>;
}
export function createDb(options: DbOptions): Database {
  const observerTimeoutMs = options.observerTimeoutMs ?? 100;
  if (
    !Number.isSafeInteger(observerTimeoutMs) ||
    observerTimeoutMs < 1 ||
    observerTimeoutMs > 2147483647
  )
    throw new Error("Invalid observer timeout");
  const keys: (keyof Limits)[] = [
    "pageSize",
    "maxPageSize",
    "maxPage",
    "filterDepth",
    "filterNodes",
    "inValues",
    "inputKeys",
  ];
  const checked = {} as Limits;
  if (
    !options.limits ||
    typeof options.limits !== "object" ||
    Array.isArray(options.limits) ||
    Reflect.ownKeys(options.limits).length !== keys.length
  )
    throw new Error("Invalid DB limits");
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(options.limits, key);
    const v = descriptor?.value;
    if (
      !descriptor?.enumerable ||
      !("value" in descriptor) ||
      !Number.isSafeInteger(v) ||
      v < 1
    )
      throw new Error("Invalid DB limits");
    checked[key] = v;
  }
  if (checked.pageSize > checked.maxPageSize)
    throw new Error("Invalid page size limits");
  const limits = Object.freeze(checked),
    reported = new WeakSet<DbFailure>();
  async function guard<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      const failure = normalizeFailure(error);
      if (!reported.has(failure)) {
        reported.add(failure);
        try {
          if (options.onError) {
            let timer: ReturnType<typeof setTimeout> | undefined;
            try {
              await Promise.race([
                Promise.resolve().then(() => options.onError!(failure)),
                new Promise<void>((resolve) => {
                  timer = setTimeout(resolve, observerTimeoutMs);
                }),
              ]);
            } finally {
              if (timer !== undefined) clearTimeout(timer);
            }
          }
        } catch {
          /* Наблюдатель не маскирует исходную ошибку. */
        }
      }
      throw failure;
    }
  }
  async function flush(callbacks: (() => void | Promise<void>)[]) {
    let first: unknown;
    let failed = false;
    for (const cb of callbacks) {
      try {
        await cb();
      } catch (e) {
        if (!failed) first = e;
        failed = true;
      }
    }
    if (failed) throw new DbFailure("post_commit", { committed: true }, first);
  }
  function bind(
    driver: Driver,
    queue?: Array<() => void | Promise<void>>,
  ): Database {
    let active = true;
    const check = () => {
      if (!active) throw new DbFailure("transaction");
    };
    const db: Database = {
      driver,
      limits,
      cursorCodec: options.cursorCodec,
      guard,
      query: (s) =>
        guard(async () => {
          check();
          return driver.query(s);
        }),
      resource: (r) => resourceApi(db, r),
      transaction: (fn, o) =>
        guard(async () => {
          check();
          if (!driver.capabilities.transactions)
            throw new DbFailure("unsupported");
          const callbacks: Array<() => void | Promise<void>> = [];
          const value = await driver.transaction(async (tx) => {
            const scoped = bind(tx, callbacks);
            try {
              return await fn(scoped);
            } finally {
              (scoped as Database & { finish(): void }).finish();
            }
          }, o);
          if (queue) queue.push(...callbacks);
          else await flush(callbacks);
          return value;
        }),
      afterCommit: async (cb) => {
        check();
        if (queue) queue.push(cb);
        else await guard(() => flush([cb]));
      },
    };
    Object.defineProperty(db, "finish", {
      value: () => {
        active = false;
      },
    });
    return db;
  }
  return bind(options.driver);
}
