/**
 * Перенос схемы по кнопке: отчёт «что ждёт решения» и выполнение решений
 * человека под секретом (`DB_ADMIN_TOKEN` в приложении).
 *
 * Живёт в библиотеке, а не в приложении, потому что не знает ничего
 * прикладного: `$app/*` не импортирует, окружение не читает, маршрутов не
 * знает. Драйвер и секрет подставляет вызывающий — поэтому модуль проверяется на
 * PGlite в тестах и годится чужому приложению на `#lib/db`.
 *
 * Драйвер — СЫРОЙ, мимо `gate`: через `gate` любой запрос при конфликте отвечает
 * `schema_pending`, а решать конфликт нужно именно в этот момент (`gate` и
 * `defineSchema` — `./index.ts`).
 */
import { DbFailure, normalizeFailure } from "../errors";
import type { Driver } from "../types";
import type { DbSchema, Resolution, SchemaReport, SyncStep } from "./index";

/** Чем кончилось решение человека. */
export type ResolveOutcome =
  | { ok: true; report: SchemaReport }
  | {
      ok: false;
      reason: "disabled" | "token" | "stale" | "invalid" | "failed";
      message: string;
    };

/** Админка переноса: отчёт для экрана и выполнение решений. */
export interface SchemaAdmin {
  /** Секрет задан: без него кнопка выключена. */
  readonly enabled: boolean;
  /** Что ждёт решения сейчас (автоматические шаги при этом применяются — они безопасны). */
  status(): Promise<SchemaReport>;
  /** Выполнить решения. Секрет сверяется до любого обращения к БД. */
  resolve(
    token: unknown,
    decisions: Resolution,
    options?: { onStep?: (step: SyncStep) => void },
  ): Promise<ResolveOutcome>;
}

/**
 * Сравнение секретов за постоянное время: сравниваются дайджесты одинаковой
 * длины, поэтому длина и совпадающий префикс не видны по времени ответа.
 *
 * @param given секрет из формы.
 * @param expected секрет из окружения.
 * @returns совпали ли.
 */
async function sameSecret(given: string, expected: string): Promise<boolean> {
  const digest = async (s: string) =>
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  const [a, b] = await Promise.all([digest(given), digest(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

/**
 * Сделать админку переноса над схемой.
 *
 * @param options.schema схема из `defineSchema`.
 * @param options.driver сырой драйвер (мимо `gate`) — за ним может стоять ленивое
 *   подключение: `status()` и `resolve()` открывают его сами.
 * @param options.token секрет `DB_ADMIN_TOKEN`; пусто — админка выключена
 *   (`enabled: false`), `resolve` отвечает `disabled` и к БД не ходит.
 * @returns `SchemaAdmin`.
 */
export function createSchemaAdmin(options: {
  schema: DbSchema;
  driver: () => Promise<Driver>;
  token: string | undefined;
}): SchemaAdmin {
  const { schema, driver, token } = options;
  return {
    enabled: !!token,
    async status() {
      return schema.sync(await driver());
    },
    async resolve(given, decisions, options = {}) {
      if (!token)
        return {
          ok: false,
          reason: "disabled",
          message: "Перенос по кнопке выключен: на сервере не задан DB_ADMIN_TOKEN.",
        };
      if (typeof given !== "string" || !given || !(await sameSecret(given, token)))
        return { ok: false, reason: "token", message: "Секрет не подошёл." };
      if (!Object.keys(decisions).length)
        return {
          ok: false,
          reason: "invalid",
          message: "Не выбрано ни одного решения.",
        };
      try {
        return {
          ok: true,
          report: await schema.sync(await driver(), { resolve: decisions, onStep: options.onStep }),
        };
      } catch (e) {
        // Секрет подтверждён — причина видна тому, кто переносит (текст БД нужен ему,
        // чтобы поправить данные), но не посетителям: экран решений только за секретом.
        const failure = e instanceof DbFailure ? e : normalizeFailure(e);
        const detail =
          failure.details.issues?.join("; ") ||
          String((failure.cause as Error | undefined)?.message ?? "");
        const reason =
          failure.kind === "conflict" && !failure.details.sqlstate
            ? "stale"
            : failure.kind === "validation" && !failure.details.sqlstate
              ? "invalid"
              : "failed";
        const head = {
          stale: "Схема уже изменилась (другой экземпляр или новая версия модели) — обновите страницу.",
          invalid: "Решение не подходит шагу.",
          failed: "База отклонила перенос, ничего не изменено.",
        }[reason];
        return {
          ok: false,
          reason,
          message: detail ? `${head} ${detail}` : head,
        };
      }
    },
  };
}
