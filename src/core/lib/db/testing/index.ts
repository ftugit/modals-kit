/**
 * Хелпер для тестов приложения: поднял БД → прогнал миграции → дал `db` → убрал за собой.
 *
 * Два транспорта на выбор, один и тот же контракт:
 *   • `url` (или `KIT_TEST_PG_URL`) — настоящий PostgreSQL; изоляция по `search_path`
 *     в уникальной схеме, которую хелпер удаляет в `finally`. Миграции обязуют
 *     таблицы создавать **без** схемы в имени (`demo_post`), иначе они уедут в `public`.
 *   • иначе — PGlite в памяти (быстро, без Docker, без прав).
 *
 * Зависимости (`pg`, `@electric-sql/pglite`) подгружаются динамически: production-сборка
 * их не видит, а в test-окружении они и так есть.
 */
import { createDb, conservativeLimits, withRetry, DbFailure } from "../index";
import type { Database, QueryResult, Row, Limits } from "../index";
import { pgAdapter } from "../adapters/pg";
import { pgliteAdapter } from "../adapters/pglite";
import { applyMigrationText } from "../sveltekit/migrate";
import type { Pool } from "pg";

export interface TestDb {
  db: Database;
  /** Схема, в которой живёт тест (для `url`-режима). */
  readonly schema: string;
  /** Сырой SQL: сиды и проверки «что реально в БД». */
  sql(text: string, values?: readonly unknown[]): Promise<QueryResult<Row>>;
  /** Список таблиц текущей схемы — удобная страховка «миграция применилась». */
  tables(): Promise<string[]>;
  /** Энкодинговая страховка: см. `TestDbOptions.encoding`. */
  readonly encoding: TestDbEncoding;
  withRetry: typeof withRetry;
}

/** Что хелпер думает об энкодине тестовой БД (см. `TestDbOptions.encoding`). */
export interface TestDbEncoding {
  readonly encoding: string;
  /** `true` = `lower('А') = 'а'`: не-ASCII складывается, `icontains`/`istartsWith` честные. */
  readonly caseFolds: boolean;
}

export interface TestDbOptions {
  /** Строка подключения к PostgreSQL; по умолчанию — `process.env.KIT_TEST_PG_URL`. */
  url?: string;
  /**
   * Требовать, чтобы БД складывала регистр не-ASCII (`lower('А') = 'а'`). По умолчанию
   * `utf8`: в `SQL_ASCII`/`LATIN1` `upper()`/`ILIKE` работают побайтово, и регистронезависимый
   * поиск по-русски даёт **ложные пустые** результаты — тесты зелёные, продукт сломан.
   * `'any'` отключает проверку (например, когда в тестах только ASCII).
   */
  encoding?: "utf8" | "any";
  /** SQL миграций, применяемых до теста (текстом, одним транзакционным прогоном). */
  migrations?: readonly string[];
  /** Явно попросить PGlite, даже если `KIT_TEST_PG_URL` задан. */
  memory?: boolean;
  limits?: Readonly<Limits>;
}

const checkEncoding = async (
  run: (text: string) => Promise<readonly Row[]>,
  expect: "utf8" | "any",
): Promise<TestDbEncoding> => {
  const row =
    (
      await run(
        "SELECT current_setting('server_encoding') AS enc, (lower('\u0410') = '\u0430') AS ci",
      )
    )[0] ?? {};
  const info: TestDbEncoding = {
    encoding: String((row as { enc?: unknown }).enc ?? "unknown"),
    caseFolds: (row as { ci?: unknown }).ci === true,
  };
  if (expect === "utf8" && !info.caseFolds)
    throw new DbFailure("unsupported", {
      issues: [
        `тестовая БД в энкодинге ${info.encoding}: lower()/ILIKE не складывают регистр не-ASCII, ` +
          `поэтому icontains/istartsWith вернут пустой результат вместо найденного. ` +
          `Пересоздайте БД с --encoding=UTF8 (--locale=C.UTF-8) или передайте { encoding: 'any' }`,
      ],
    });
  return info;
};

const hex = (n: number) =>
  Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join("");

export async function withTestDb<T>(
  fn: (t: TestDb) => Promise<T>,
  options: TestDbOptions = {},
): Promise<T> {
  const envUrl =
    typeof process !== "undefined" ? process.env?.KIT_TEST_PG_URL : undefined;
  const url = options.memory ? undefined : (options.url ?? envUrl);
  const limits = options.limits ?? conservativeLimits;

  if (url) {
    const { Pool } = await import("pg");
    const schema = "kit_test_" + hex(10);
    // search_path — параметром соединения, а не `SET`'ом: в transaction-пулере
    // (PgBouncer/Supavisor) SET между запросами теряется, а options живут на всём
    // подключении, и новый клиент пула получает ту же схему.
    const pool: Pool = new Pool({
      connectionString: url,
      max: 2,
      options: `-c search_path=${schema}`,
    });
    try {
      await pool.query(`CREATE SCHEMA "${schema}"`);
      const db = createDb({ driver: pgAdapter(pool, 4, 15000), limits });
      const sql = (text: string, values?: readonly unknown[]) =>
        db.query<Row>({ text, values });
      // Страховка «startup-параметр дожил до сервера». Её нет в идеале, но ровно на
      // ней поимка pooler-ловушки: PgBouncer/Supavisor в transaction mode игнорируют
      // `options=-c …` (замерено: `SHOW search_path` = «\"$user\", public»), и тест,
      // уверенный, что он в изолированной схеме, писал бы в `public` — то есть в чужие
      // данные. Проверяем два отдельных подключения: на одном пулере «повезёт» может
      // повториться, на двух — почти нет.
      const seenSchema = async () => {
        const c = await pool.connect();
        try {
          return String((await c.query("SELECT current_schema() AS s")).rows[0]?.s ?? "");
        } finally {
          c.release();
        }
      };
      const seen = [await seenSchema(), await seenSchema()];
      if (!seen.every((value) => value === schema))
        throw new DbFailure("unsupported", {
          issues: [
            `search_path не применился (текущая схема: ${seen.join(", ")}; ожидалась ${schema}). ` +
              `Так ведёт себя pooler в transaction mode (PgBouncer/Supavisor отбрасывает startup-параметры): ` +
              `без проверки тест писал бы в public. Возьмите прямое соединение либо укажите схему в имени таблицы ('schema.table').`,
          ],
        });
      const encoding = await checkEncoding(
        async (text) => (await pool.query(text)).rows as Row[],
        options.encoding ?? "utf8",
      );
      const t: TestDb = {
        db,
        schema,
        encoding,
        sql,
        tables: async () =>
          (
            await sql(
              `SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = $1 ORDER BY tablename`,
              [schema],
            )
          ).rows.map((r) => String(r.tablename)),
        withRetry,
      };
      for (const migration of options.migrations ?? [])
        await applyMigrationText(db, migration);
      return await fn(t);
    } finally {
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => {});
      await pool.end().catch(() => {});
    }
  }

  const { PGlite } = await import("@electric-sql/pglite");
  const instance = new PGlite();
  try {
    const db = createDb({ driver: pgliteAdapter(instance), limits });
    for (const migration of options.migrations ?? [])
      await applyMigrationText(db, migration);
    const t: TestDb = {
      db,
      schema: "public",
      encoding: await checkEncoding(
        async (text) => (await instance.query(text)).rows as Row[],
        options.encoding ?? "utf8",
      ),
      sql: (text, values) => db.query<Row>({ text, values }),
      tables: async () =>
        (
          await db.query<Row>({
            text: `SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
          })
        ).rows.map((r) => String(r.tablename)),
      withRetry,
    };
    return await fn(t);
  } finally {
    await instance.close().catch(() => {});
  }
}
