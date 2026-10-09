/**
 * Node-only: PGlite (dev/тесты) и pg-пул (Vercel/свой Node).
 *
 * Отдельный вход `$lib/db/sveltekit/node` — чтобы в Workers-сборку
 * `node:fs` и WASM PGlite не попадали даже через barrel.
 */
import { PGlite } from "@electric-sql/pglite";
import { mkdir, open, realpath, unlink } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { Pool, type PoolConfig } from "pg";
import { pgAdapter } from "../adapters/pg";
import { pgliteAdapter } from "../adapters/pglite";
import type { Driver } from "../types";

export interface NodeDatabase {
  db: PGlite;
  dataDir: string;
  close(): Promise<void>;
}
/** Только файловый каталог: опечатка в URI не должна включить RAM-режим. */
export function resolveDatabaseDir(projectRoot: string, configuredDir: string): string {
  const value = configuredDir.trim();
  if (!value || /^[a-z][a-z0-9+.-]*:/i.test(value))
    throw new Error("DATABASE_DIR must be a filesystem path, not a storage URI");
  return isAbsolute(value) ? resolve(value) : resolve(projectRoot, value);
}
/**
 * Embedded PostgreSQL с дисковым каталогом и строгой durability.
 * Каталогом владеет ОДИН процесс: lock-файл нужен не «на всякий случай» —
 * PGlite не переживает двух писателей, а dev-сервер и `npm test` в одном
 * чек-ауте иначе мешают друг другу (в тестах используйте `memory: true`).
 */
export async function openNodeDatabase(
  projectRoot: string,
  configuredDir: string,
  options: { memory?: boolean; lockName?: string } = {},
): Promise<NodeDatabase> {
  const lockName = options.lockName ?? ".kit-db.lock";
  if (options.memory) {
    const db = new PGlite({ relaxedDurability: false });
    await db.waitReady;
    return {
      db,
      dataDir: ":memory:",
      close: async () => {
        await db.close();
      },
    };
  }
  const requestedDir = resolveDatabaseDir(projectRoot, configuredDir);
  await mkdir(requestedDir, { recursive: true, mode: 0o700 });
  const dataDir = await realpath(requestedDir);
  const lockPath = join(dataDir, lockName);
  const lock = await open(lockPath, "wx", 0o600).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "EEXIST")
      throw new Error(
        `Database directory is locked: ${dataDir}. Stop its owner; after a crash verify no owner is running before removing ${lockName}.`,
      );
    throw error;
  });
  let db: PGlite | undefined;
  try {
    await lock.writeFile(
      JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }) + "\n",
    );
    await lock.close();
    db = new PGlite(dataDir, { relaxedDurability: false });
    await db.waitReady;
    await db.query("SELECT 1");
  } catch (error) {
    await lock.close().catch(() => {});
    if (db) await db.close();
    await unlink(lockPath).catch(() => {});
    throw error;
  }
  const ready = db;
  let closing: Promise<void> | undefined;
  return {
    db: ready,
    dataDir,
    close() {
      return (closing ??= (async () => {
        await ready.close();
        await unlink(lockPath).catch(() => {});
      })());
    },
  };
}
export function pgliteDriver(db: PGlite): Driver {
  return pgliteAdapter(db);
}

export interface PgPoolOptions {
  connectionString: string;
  /**
   * На serverless (Vercel) пул живёт внутри одного isolate: `max` надо держать
   * маленьким (1 на инстанс + пулер перед БД), иначе число соединений
   * умножается на число холодных стартов.
   */
  max?: number;
  connectionTimeoutMillis?: number;
  /**
   * Отправлять ли `statement_timeout`/`application_name` startup-параметрами соединения.
   * По умолчанию `send`; за pooler'ом в transaction mode ставят `skip` (иначе — отказ
   * подключения или молча нулевой `statement_timeout`).
   */
  startupParameters?: "send" | "skip";
  idleTimeoutMillis?: number;
  /**
   * TCP keepalive по умолчанию **включён**, первый пробник через 10 с. Фронт дешёвых
   * хостингов и облачный NAT молча выбрасывают соединение, которое ничего не писало:
   * без keepalive пул продолжает держать труп-сокет, и первый запрос после простоя висит
   * до таймаута. Замер 2026-10-09 на живом хосте оператора: запрос сразу после старта —
   * 200 за 2.7 с; тот же запрос после 150 с простоя — 500 за ровно 30 с, при том что
   * сырое рукопожатие в этот же момент отвечало за 372 мс. То есть лежал именно пул.
   */
  keepAlive?: boolean;
  keepAliveInitialDelayMillis?: number;
  statementTimeoutMs?: number;
  /** Значение `application_name`: без него pg_stat_activity не отличает инстансы. */
  applicationName?: string;
  /**
   * Проверка сертификата не отключается: опция есть только чтобы явно
   * сказать `require`/`no-verify` в своём конфиге, и по умолчанию — ничего.
   */
  ssl?: PoolConfig["ssl"];
  transactionTimeoutMs?: number;
  maxInFlight?: number;
}
export interface PgRuntime {
  driver: Driver;
  pool: Pool;
  close(): Promise<void>;
}
export function openPgPool(options: PgPoolOptions): PgRuntime {
  const {
    max = 4,
    connectionTimeoutMillis = 10_000,
    idleTimeoutMillis = 30_000,
    keepAlive = true,
    keepAliveInitialDelayMillis = 10_000,
    statementTimeoutMs = 15_000,
    transactionTimeoutMs = 30_000,
    maxInFlight = 32,
    startupParameters = "send",
  } = options;
  if (!options.connectionString) throw new Error("Missing DATABASE_URL");
  // `max`/`maxInFlight` должны быть не меньше 1 (ноль = «вечно ждать» и тихий
  // deadlock в admission-cap), таймауты допускают 0 = «выключено».
  for (const [name, value, min] of [
    ["max", max, 1],
    ["maxInFlight", maxInFlight, 1],
    ["connectionTimeoutMillis", connectionTimeoutMillis, 0],
    ["idleTimeoutMillis", idleTimeoutMillis, 0],
    ["keepAliveInitialDelayMillis", keepAliveInitialDelayMillis, 0],
    ["statementTimeoutMs", statementTimeoutMs, 0],
    ["transactionTimeoutMs", transactionTimeoutMs, 0],
  ] as const)
    if (!Number.isSafeInteger(value) || (value as number) < min)
      throw new Error(`Invalid pg pool option: ${name} (нужно целое ≥ ${min})`);
  const pool = new Pool({
    connectionString: options.connectionString,
    max,
    connectionTimeoutMillis,
    idleTimeoutMillis,
    keepAlive,
    keepAliveInitialDelayMillis,
    // За pooler'ом в transaction mode (PgBouncer/Supavisor) эти два параметра уходят в
    // startup-пакет и там либо отбиваются ошибкой `unsupported startup parameter`, либо
    // молча игнорируются (замерено на 1.24.1: `SHOW statement_timeout` = 0). Тогда их
    // ставят на роли/БД, а сюда передают `startupParameters: 'skip'`.
    ...(startupParameters === "send"
      ? {
          statement_timeout: statementTimeoutMs,
          ...(options.applicationName ? { application_name: options.applicationName } : {}),
        }
      : {}),
    ...(options.ssl ? { ssl: options.ssl } : {}),
  });
  // Не печатаем connectionString и исходные ошибки: в них бывают credentials.
  pool.on("error", () => console.error("Idle PostgreSQL connection failed"));
  return {
    pool,
    driver: pgAdapter(pool, maxInFlight, transactionTimeoutMs),
    close: () => pool.end(),
  };
}
/** `process.env` или `platform.env` — одна форма доступа к настройкам. */
export function envReader(
  ...sources: (Record<string, string | undefined> | undefined)[]
): (key: string) => string | undefined {
  return (key) => {
    for (const source of sources) {
      const value = source?.[key];
      if (typeof value === "string" && value) return value;
    }
    return undefined;
  };
}
