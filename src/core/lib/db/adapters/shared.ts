import { DbFailure } from "../errors";
import type {
  Capabilities,
  Driver,
  QueryResult,
  Row,
  Statement,
  TxOptions,
} from "../types";
export const transactionalCapabilities: Capabilities = {
  transactions: true,
  savepoints: true,
  sqlstate: true,
  isolationLevels: ["read committed", "repeatable read", "serializable"],
};
export function unsupported(): never {
  throw new DbFailure("unsupported");
}
export function normalizeValue(v: unknown): unknown {
  if (typeof v === "bigint") return v.toString();
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map(normalizeValue);
  // Только plain object: не разбирать произвольные объекты драйвера как данные.
  if (v && Object.getPrototypeOf(v) === Object.prototype)
    return Object.fromEntries(
      Object.entries(v).map(([k, x]) => [k, normalizeValue(x)]),
    );
  return v;
}
export function result<T extends Row>(
  rows: Row[],
  rowCount?: number | null,
): QueryResult<T> {
  return {
    rows: rows.map(normalizeValue) as T[],
    rowCount: rowCount ?? rows.length,
  };
}
export type Execute = (s: Statement) => Promise<QueryResult>;
export function beginSQL(o: TxOptions = {}, caps: Capabilities): string {
  if (o.isolation && !caps.isolationLevels.includes(o.isolation))
    return unsupported();
  return (
    "BEGIN" +
    (o.isolation ? " ISOLATION LEVEL " + o.isolation.toUpperCase() : "") +
    (o.readOnly ? " READ ONLY" : "")
  );
}
/** Tx-bound driver: ожидает незавершённые запросы, запрещает escape и параллельные savepoints. */
export async function scope<T>(
  execute: Execute,
  caps: Capabilities,
  fn: (d: Driver) => Promise<T>,
): Promise<T> {
  let active = true,
    child = false,
    sequence = 0,
    hasFailed = false,
    failed: unknown;
  const pending = new Set<Promise<unknown>>();
  async function control(text: string) {
    try { return await execute({ text }); }
    catch (e) {
      hasFailed = true;
      failed ??= e;
      throw e;
    }
  }
  function check() {
    if (!active || child) throw new DbFailure("transaction");
  }
  const driver: Driver = {
    capabilities: caps,
    inTransaction: true,
    query<R extends Row>(s: Statement) {
      check();
      const p = execute(s).catch((e) => {
        hasFailed = true;
        failed = e;
        throw e;
      });
      pending.add(p);
      void p.then(
        () => pending.delete(p),
        () => pending.delete(p),
      );
      return p as Promise<QueryResult<R>>;
    },
    transaction<R>(cb: (d: Driver) => Promise<R>, options?: TxOptions) {
      check();
      if (
        !caps.savepoints ||
        options?.isolation ||
        options?.readOnly !== undefined
      )
        return Promise.reject(new DbFailure("unsupported"));
      const previous = [...pending];
      child = true;
      const name = "db_sp_" + ++sequence;
      const running = (async () => {
        try {
          await Promise.allSettled(previous);
          if (hasFailed) throw failed ?? new DbFailure("transaction");
          await control("SAVEPOINT " + name);
          try {
            const value = await scope(execute, caps, cb);
            await control("RELEASE SAVEPOINT " + name);
            return value;
          } catch (e) {
            try {
              await control("ROLLBACK TO SAVEPOINT " + name);
              await control("RELEASE SAVEPOINT " + name);
            } catch {
              // Parent уже poisoned; сохраняем исходную причину отказа операции.
            }
            throw e;
          }
        } finally {
          child = false;
        }
      })();
      pending.add(running);
      void running.then(
        () => pending.delete(running),
        () => pending.delete(running),
      );
      return running;
    },
  };
  try {
    const value = await fn(driver);
    await Promise.allSettled([...pending]);
    if (child) throw new DbFailure("transaction");
    if (hasFailed) throw failed ?? new DbFailure("transaction");
    return value;
  } finally {
    active = false;
    await Promise.allSettled([...pending]);
  }
}
export async function runTransaction<T>(
  execute: Execute,
  caps: Capabilities,
  fn: (d: Driver) => Promise<T>,
  options?: TxOptions,
): Promise<T> {
  const begin = beginSQL(options, caps);
  try {
    await execute({ text: begin });
    const value = await scope(execute, caps, fn);
    await execute({ text: "COMMIT" });
    return value;
  } catch (e) {
    try {
      await execute({ text: "ROLLBACK" });
    } catch {
      /* Сохраняем первоначальную причину; caller уничтожает/закрывает connection. */
    }
    throw e;
  }
}
