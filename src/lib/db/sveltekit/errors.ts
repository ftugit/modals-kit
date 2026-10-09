import { DbFailure, normalizeFailure, type FailureKind } from "../errors";
import { BodyTooLarge } from "./query";

/** Те же коды, что и в источнике (presentFailure), но без сборки Response. */
export const FAILURE_STATUS: Record<FailureKind, number> = {
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
export interface KitErrorBody {
  message: string;
  /** Стабильный код для UI/тестов: `code: 'not_found'` и т. п. */
  code: string;
  fields?: readonly string[];
  committed?: boolean;
  /** Только в dev: код SQLSTATE и имя условия. SQL/параметры/cause — никогда. */
  diagnostic?: Record<string, unknown>;
}

/**
 * Нагрузку в `throw error(status, body)` (SvelteKit) либо `return fail(status, body)`.
 * Возвращаем данные, а не бросаем: `error()` импортируется из `@sveltejs/kit`,
 * и импорт оставлен приложению — пакет не зависит от kit в рантайме.
 */
export function toKitError(
  error: unknown,
  development = false,
): { status: number; body: KitErrorBody } {
  if (error instanceof BodyTooLarge)
    return { status: 413, body: { message: "Body too large", code: "payload_too_large" } };
  const e = normalizeFailure(error);
  const body: KitErrorBody = {
    message: e.message,
    code: e.kind,
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
  };
  return { status: FAILURE_STATUS[e.kind] ?? 500, body };
}

/**
 * Для form actions: поле + текст ошибки из Standard Schema. В источнике
 * сообщения схемы терялись (`fail('validation', key)`), поэтому в UI
 * доезжал только «Invalid input» — здесь они идут в `fieldErrors`
 * в формате `$lib/form`-ошибок (`path`/`message`).
 */
export function toFormFailure(
  error: unknown,
  development = false,
): {
  status: number;
  data: {
    message: string;
    code: string;
    fieldErrors: Record<string, string[]>;
    formErrors: string[];
  };
} {
  const { status, body } = toKitError(error, development);
  const e = normalizeFailure(error);
  const fieldErrors: Record<string, string[]> = {};
  const formErrors: string[] = [];
  if (e instanceof DbFailure) {
    const messages = e.details.issues?.length ? [...e.details.issues] : [];
    if (e.details.field) {
      fieldErrors[e.details.field] = messages.length ? messages : [e.message];
    } else formErrors.push(...(messages.length ? messages : [e.message]));
  }
  if (body.fields) for (const field of body.fields) fieldErrors[field] ??= [e.message];
  return { status, data: { message: body.message, code: body.code, fieldErrors, formErrors } };
}
