import { SQLSTATE } from "./sqlstate";
export type FailureKind =
  | "validation"
  | "forbidden"
  | "not_found"
  | "unsupported"
  | "conflict"
  | "database"
  | "unavailable"
  | "cursor"
  | "transaction"
  | "post_commit"
  | "schema_pending";
const messages: Record<FailureKind, string> = {
  validation: "Invalid input",
  forbidden: "Operation not permitted",
  not_found: "Record not found or not visible",
  unsupported: "Operation not supported by this transport",
  conflict: "Data conflict",
  database: "Database operation failed",
  unavailable: "Database unavailable",
  cursor: "Invalid or expired cursor",
  transaction: "Transaction aborted",
  post_commit: "Data committed, notification failed",
  schema_pending: "Database schema update required",
};
/**
 * Ошибка конкретного поля (или записи целиком, если `field` нет) в общем виде:
 * код и параметры — для словаря текстов приложения, `message` — готовый текст.
 * Коды совпадают с кодами правил форм (`required`, `minLength`, `maxLength`,
 * `minValue`, `maxValue`, `integer`, `oneOf`, `pattern`, `minCount`, `maxCount`,
 * `type.date`, `type.datetime`) плюс свои: `unique`, `check`, `invalid`, `custom`.
 */
export interface FieldError {
  /** Поле ресурса (у JSON-колонки — с ключом внутри: `data.mail`). Нет — ошибка про запись целиком (составной unique). */
  field?: string;
  code: string;
  params?: Record<string, unknown>;
  /** Готовый текст: свой текст модели с подстановками либо текст схемы. */
  message: string;
  /**
   * Свой текст — из `messages` поля или из самой схемы (`s.text({ message })`),
   * до подстановок `{min}`, `{max}`… Есть — он сильнее любых словарей текстов.
   */
  template?: string;
}
/**
 * Issue в формате Standard Schema (`message`, `path`) плюс `code`/`params`/`template`.
 * Так ошибки БД читает любая библиотека форм без импорта `lib/db`.
 */
export interface FailureIssue {
  message: string;
  /** Путь поля: `['title']`; у ключа внутри JSON-колонки — `['data', 'mail']`. */
  path?: readonly [string, ...string[]];
  code: string;
  params?: Record<string, unknown>;
  template?: string;
}
export class DbFailure extends Error {
  readonly name = "DbFailure";
  constructor(
    readonly kind: FailureKind,
    readonly details: {
      sqlstate?: string;
      publicFields?: readonly string[];
      condition?: string;
      constraint?: string;
      /** Колонка из ошибки PostgreSQL (`not_null_violation`). */
      column?: string;
      field?: string;
      /** Ошибки по полям: все сразу, а не первая. */
      errors?: readonly FieldError[];
      retryable?: boolean;
      committed?: boolean;
      /** Тексты из Standard Schema: только про присланные значения, не про БД. */
      issues?: readonly string[];
      /** Цепочка удаления: звено, путь от корня (ключи моделей) и сколько строк упёрлось. */
      model?: string;
      path?: readonly string[];
      count?: number;
    } = {},
    readonly cause?: unknown,
  ) {
    super(messages[kind]);
  }
}
export function normalizeFailure(error: unknown): DbFailure {
  if (error instanceof DbFailure) return error;
  const e =
    error && typeof error === "object"
      ? (error as Record<string, unknown>)
      : {};
  // Только структурированный SQLSTATE, никогда regex над сообщением драйвера.
  const code =
    typeof e.code === "string" &&
    /^[0-9A-Z]{5}$/.test(e.code) &&
    (Object.prototype.hasOwnProperty.call(SQLSTATE, e.code) ||
      (typeof e.severity === "string" && typeof e.routine === "string"))
      ? e.code
      : undefined;
  let kind: FailureKind = "database";
  if (code === "23505" || code === "23503" || code === "23001") kind = "conflict";
  else if (code === "23502" || code === "23514" || code?.startsWith("22"))
    kind = "validation";
  // Отказ прав НА СТОРОНЕ БД (триггер/RLS/GRANT) — это 403, а не «внутренняя ошибка».
  // Без этой ветки `RAISE EXCEPTION … ERRCODE 42501` из триггера составной коллекции
  // давал 500, и клиент не мог отличить «нельзя» от «сервер упал».
  else if (code === "42501" || code === "42502") kind = "forbidden";
  else if (code && /^(08|40|53|57)/.test(code)) kind = "unavailable";
  return new DbFailure(
    kind,
    {
      sqlstate: code,
      condition: code ? SQLSTATE[code] : undefined,
      constraint: typeof e.constraint === "string" ? e.constraint : undefined,
      column: typeof e.column === "string" ? e.column : undefined,
      retryable: code === "40001" || code === "40P01",
    },
    error,
  );
}
export function fail(
  kind: FailureKind,
  field?: string,
  issues?: readonly string[],
): never {
  throw new DbFailure(
    kind,
    field || issues ? { ...(field ? { field } : {}), ...(issues ? { issues } : {}) } : {},
  );
}
/** Отказ `validation` со всеми ошибками полей сразу. */
export function failFields(errors: readonly FieldError[]): never {
  const first = errors.find((x) => x.field)?.field;
  throw new DbFailure("validation", {
    ...(first ? { field: first } : {}),
    // `issues` — прежний вид (тексты первого поля): на нём стоят перенесённые тесты
    issues: errors.filter((x) => x.field === first).map((x) => x.message),
    errors: Object.freeze([...errors]),
  });
}
/**
 * Ошибки сбоя как Standard Schema issues: путь — имя поля. `null` — у сбоя нет
 * ошибок по полям (отказ прав, недоступность БД…), показывать его надо иначе.
 * Пример для формы: `const i = failureIssues(e); if (i) ctx.fail(i)`.
 */
export function failureIssues(error: unknown): FailureIssue[] | null {
  if (!(error instanceof DbFailure) || !error.details.errors?.length) return null;
  return error.details.errors.map((x) => ({
    message: x.message,
    code: x.code,
    ...(x.field ? { path: x.field.split(".") as [string, ...string[]] } : {}),
    ...(x.params ? { params: x.params } : {}),
    ...(x.template !== undefined ? { template: x.template } : {}),
  }));
}
/** Публичный вид ошибок полей: без `template` (это деталь показа). */
const publicErrors = (e: DbFailure) =>
  e.details.errors?.length
    ? { errors: e.details.errors.map(({ template: _t, ...rest }) => rest) }
    : {};
/** Presenter не отдаёт SQL, параметры, cause/stack даже в dev. */
export function presentFailure(error: unknown, development = false) {
  const e = normalizeFailure(error);
  const statuses: Record<FailureKind, number> = {
    validation: 422,
    forbidden: 403,
    not_found: 404,
    unsupported: 501,
    conflict: 409,
    database: 500,
    unavailable: 503,
    cursor: 400,
    transaction: 409,
    post_commit: 500,
    schema_pending: 503,
  };
  return {
    status: statuses[e.kind],
    body: {
      error: {
        code: e.kind,
        message: e.message,
        ...(e.details.publicFields ? { fields: e.details.publicFields } : {}),
        ...publicErrors(e),
        ...(e.details.committed ? { committed: true } : {}),
        ...(development
          ? {
              diagnostic: {
                sqlstate: e.details.sqlstate,
                condition: e.details.condition,
                field: e.details.field,
              },
            }
          : {}),
      },
    },
  };
}
