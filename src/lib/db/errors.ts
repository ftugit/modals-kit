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
  | "post_commit";
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
};
export class DbFailure extends Error {
  readonly name = "DbFailure";
  constructor(
    readonly kind: FailureKind,
    readonly details: {
      sqlstate?: string;
      publicFields?: readonly string[];
      condition?: string;
      constraint?: string;
      field?: string;
      retryable?: boolean;
      committed?: boolean;
      /** Тексты из Standard Schema: только про присланные значения, не про БД. */
      issues?: readonly string[];
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
  if (code === "23505" || code === "23503") kind = "conflict";
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
  };
  return {
    status: statuses[e.kind],
    body: {
      error: {
        code: e.kind,
        message: e.message,
        ...(e.details.publicFields ? { fields: e.details.publicFields } : {}),
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
