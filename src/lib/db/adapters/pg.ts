import { DbFailure } from "../errors";
import type { Pool } from "pg";
import type { Driver, Row, Statement } from "../types";
import { result, runTransaction, transactionalCapabilities } from "./shared";
/** Жизненным циклом pool владеет runtime, не resource. */
export function pgAdapter(
  pool: Pool,
  maxInFlight = 32,
  transactionTimeoutMs = 30000,
): Driver {
  if (!Number.isSafeInteger(maxInFlight) || maxInFlight < 1)
    throw new Error("Invalid PostgreSQL concurrency limit");
  if (
    !Number.isSafeInteger(transactionTimeoutMs) ||
    transactionTimeoutMs < 1 ||
    transactionTimeoutMs > 2147483647
  )
    throw new Error("Invalid PostgreSQL transaction timeout");
  let active = 0;
  async function admitted<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= maxInFlight) throw new DbFailure("unavailable");
    active++;
    try {
      return await fn();
    } finally {
      active--;
    }
  }
  /**
   * Отмена по signal. `pool.query` не даёт ручки на соединение, поэтому
   * отменяемый запрос идёт через отдельный Client: cancel на сервере
   * (pg_cancel_backend) + разрушение сокета, если отмена не дошла.
   * Без signal путь остаётся прежним — одним `pool.query`.
   */
  async function cancellableQuery(s: Statement): Promise<{ rows: Row[]; rowCount: number | null }> {
    const c = await pool.connect();
    let cancel: () => void = () => {};
    let ok = false;
    const aborted = new Promise<never>((_, reject) => {
      cancel = () => {
        // processID есть у pg.Client в runtime, но не в @types/pg 8.23.
        const pid = (c as unknown as { processID?: number }).processID;
        if (pid)
          void pool
            .query("SELECT pg_cancel_backend($1)", [pid])
            .catch(() => {});
        void c.end().catch(() => {});
        reject(new DbFailure("unavailable"));
      };
      if (s.signal?.aborted) cancel();
      else s.signal?.addEventListener("abort", cancel, { once: true });
    });
    try {
      const r = await Promise.race([
        c.query(s.text, [...(s.values ?? [])]),
        aborted,
      ]);
      ok = true;
      return r;
    } finally {
      // Клиент обязан вернуться в пул на ЛЮБОМ пути. Это не косметика: signal в
      // SvelteKit есть у каждого запроса (`context.ts` берёт `event.request.signal`),
      // и пока здесь не было release, пул высыхал за несколько запросов — приложение
      // висело ровно на `connectionTimeoutMillis` и отдавало 500 (поймано 2026-10-09
      // на живом хосте: pg_stat_activity показывал наши idle-соединения, а сырой
      // Pool из pg тому же простою не поддавался).
      // Сбойный/отменённый клиент из пула убираем — приём из pg-pool: `release(err)`.
      // Повторный release запрещён самим пулом (`_releaseOnce`), поэтому end() здесь
      // уже не нужен: сокет гасит `cancel()`.
      s.signal?.removeEventListener("abort", cancel);
      c.release(ok ? undefined : new Error("pg: запрос отменён или оборвался — соединение не переиспользуем"));
    }
  }
  return {
    capabilities: transactionalCapabilities,
    async query<T extends Row>(s: Statement) {
      if (s.signal)
        return admitted(async () => {
          const r = await cancellableQuery(s);
          return result<T>(r.rows, r.rowCount);
        });
      return admitted(async () => {
        const r = await pool.query<Row>(s.text, [...(s.values ?? [])]);
        return result<T>(r.rows, r.rowCount);
      });
    },
    async transaction(fn, options) {
      return admitted(async () => {
        const c = await pool.connect();
        let broken = false,
          closed = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let onError: (error: Error) => void = () => {};
        let interrupt: (e: unknown) => void = () => {};
        const onAbort = () => {
          broken = true;
          interrupt(new DbFailure("unavailable"));
        };
        const interrupted = new Promise<never>((_, reject) => {
          interrupt = reject;
          onError = (error) => {
            broken = true;
            reject(error);
          };
          c.once?.("error", onError);
          timer = setTimeout(() => {
            broken = true;
            reject(new DbFailure("transaction"));
          }, transactionTimeoutMs);
          // Отмена запроса (event.request.signal) обрывает транзакцию:
          // ROLLBACK делает runTransaction, соединение возвращается в pool.
          if (options?.signal?.aborted) onAbort();
          else options?.signal?.addEventListener("abort", onAbort, { once: true });
        });
        try {
          return await Promise.race([
            runTransaction(
              async (s) => {
                if (closed) throw new DbFailure("transaction");
                try {
                  const r = await c.query(s.text, [...(s.values ?? [])]);
                  if (s.text === "COMMIT" && r.command !== "COMMIT") {
                    broken = true;
                    throw new DbFailure("transaction");
                  }
                  return result(r.rows, r.rowCount);
                } catch (e) {
                  if (s.text === "ROLLBACK") broken = true;
                  throw e;
                }
              },
              transactionalCapabilities,
              fn,
              options,
            ),
            interrupted,
          ]);
        } finally {
          closed = true;
          if (timer !== undefined) clearTimeout(timer);
          c.removeListener?.("error", onError);
          options?.signal?.removeEventListener("abort", onAbort);
          c.release(broken);
        }
      });
    },
  };
}
