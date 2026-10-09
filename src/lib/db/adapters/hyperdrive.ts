import { DbFailure } from "../errors";
import { result, runTransaction, transactionalCapabilities } from "./shared";
import type { Driver, Row, Statement } from "../types";
import { Client } from "pg";

/**
 * Cloudflare Workers (и любой «client-per-request» рантайм) через Hyperdrive.
 *
 * Почему отдельный адаптер, а не `pgAdapter(Pool)`: Cloudflare рекомендует
 * создавать Client на запрос — пул держит под ним сам Hyperdrive, а новый
 * `pg.Pool` в Worker'е умножал бы соединения на каждый isolate
 * (best-practices Cloudflare, «create a new client per request»).
 * Требования: `pg >= 8.16.3`, `compatibility_flags: ["nodejs_compat"]`,
 * привязка `HYPERDRIVE` (см. developers.cloudflare.com/hyperdrive).
 *
 * PGlite для Workers не переносится: ему нужна файловая система и одиночный
 * писатель, а persistence на边缘 нет — поэтому он остаётся dev/test-режимом.
 */
export interface HyperdriveConfig {
  /** `env.HYPERDRIVE.connectionString`. */
  connectionString: string;
  /** Технический дедлайн одной операции (query или всей транзакции). Default 15000. */
  timeoutMs?: number;
  /**
   * Fail-fast параллелизм: у Workers лимит одновременных внешних соединений
   * мал, поэтому лишний запрос должен отказывать сразу, а не висеть в очереди.
   * Default 5.
   */
  maxInFlight?: number;
  /** Тестам подменяет транспорт; в приложении не используется. */
  openClient?: (connectionString: string) => Promise<Client>;
}

async function withDeadline<T>(
  client: Client,
  ms: number,
  body: () => Promise<T>,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  try {
    return await Promise.race([
      body(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          reject(new DbFailure("unavailable"));
        }, ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    // Разрушаем соединение именно при дедлайне: обычный отказ SQL остаётся
    // «живым» клиентом, его закрывает вызывающий код.
    if (timedOut) await client.end().catch(() => {});
  }
}

export function hyperdriveAdapter(config: HyperdriveConfig): Driver {
  const timeoutMs = config.timeoutMs ?? 15000,
    max = config.maxInFlight ?? 5;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 2147483647 ||
    !Number.isSafeInteger(max) ||
    max < 1
  )
    throw new Error("Invalid Hyperdrive limits");
  if (typeof config.connectionString !== "string" || !config.connectionString)
    throw new Error("Hyperdrive connection string required");
  let active = 0;
  async function admitted<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= max) throw new DbFailure("unavailable");
    active++;
    try {
      return await fn();
    } finally {
      active--;
    }
  }
  const open =
    config.openClient ??
    (async (connectionString: string) => {
      const client = new Client({ connectionString });
      await client.connect();
      return client;
    });
  async function withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
    const client = await open(config.connectionString);
    try {
      return await withDeadline(client, timeoutMs, () => fn(client));
    } finally {
      await client.end().catch(() => {});
    }
  }
  return {
    capabilities: transactionalCapabilities,
    async query<T extends Row>(s: Statement) {
      return admitted(async () =>
        withClient(async (client) => {
          if (s.signal?.aborted) throw new DbFailure("unavailable");
          const run = () => client.query<Row>(s.text, [...(s.values ?? [])]);
          const r = s.signal
            ? await Promise.race([
                run(),
                new Promise<never>((_, reject) =>
                  s.signal!.addEventListener(
                    "abort",
                    () => reject(new DbFailure("unavailable")),
                    { once: true },
                  ),
                ),
              ]).finally(() => client.end().catch(() => {}))
            : await run();
          return result<T>(r.rows as Row[], r.rowCount);
        }),
      );
    },
    async transaction(fn, options) {
      return admitted(async () =>
        withClient((client) =>
          runTransaction(
            async (s) => {
              if (options?.signal?.aborted)
                throw new DbFailure("unavailable");
              const r = await client.query(s.text, [...(s.values ?? [])]);
              if (s.text === "COMMIT" && r.command !== "COMMIT")
                throw new DbFailure("transaction");
              return result(r.rows as Row[], r.rowCount);
            },
            transactionalCapabilities,
            fn,
            options,
          ),
        ),
      );
    },
  };
}
