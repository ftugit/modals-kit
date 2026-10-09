/**
 * Операции над `Database`, которые не belong к ресурсу: повтор транзакции при
 * сериализационном конфликте. Отдельный файл — чтобы ядро оставалось диффимым
 * с источником (см. PORTING.md §3).
 */
import { DbFailure } from "./errors";
import type { Database, Isolation } from "./types";

export interface RetryOptions {
  /** Сколько всего попыток, включая первую (default 3, максимум 10). */
  attempts?: number;
  /** Базовая пауза, мс (default 20). */
  baseDelayMs?: number;
  /** Потолок паузы, мс (default 500). */
  maxDelayMs?: number;
  isolation?: Isolation;
  readOnly?: boolean;
  /** Вызывается перед каждой повторной попыткой. */
  onRetry?: (error: DbFailure, attempt: number) => void;
  /** Инъекция сна — для тестов и для runtime с `scheduler.wait`. */
  wait?: (ms: number) => Promise<void>;
  /** Повторять и при `kind: "transaction"` (например, internal timeout адаптера). */
  retryTransactionKind?: boolean;
}

const REPEATABLE = (e: DbFailure, extra: boolean): boolean =>
  (e.details as { retryable?: boolean }).retryable === true ||
  (extra && e.kind === "transaction");

/**
 * `db.transaction` с автоматическим повтором на `40001 serialization_failure` и
 * `40P01 deadlock_detected` — единственные ошибки, которые безопасны для повтора:
 * транзакция уже откатана целиком. Экспоненциальная пауза с джиттером, экспоненциальный
 * рост до `maxDelayMs`.
 *
 * Ретраится **всю** callback-функцию: она обязана быть идемпотентной относительно
 * внешнего мира (не слать письма/не дёргать платёж изнутри tx без `db.afterCommit`).
 */
export async function withRetry<T>(
  db: Database,
  fn: (tx: Database) => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const attempts = Math.max(1, Math.min(10, options.attempts ?? 3));
  const base = Math.max(0, options.baseDelayMs ?? 20);
  const cap = Math.max(base, options.maxDelayMs ?? 500);
  const sleep =
    options.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let last: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await db.transaction(fn, {
        ...(options.isolation ? { isolation: options.isolation } : {}),
        ...(options.readOnly !== undefined ? { readOnly: options.readOnly } : {}),
      });
    } catch (error) {
      last = error;
      const retryable =
        error instanceof DbFailure &&
        REPEATABLE(error, options.retryTransactionKind === true);
      if (!retryable || attempt === attempts) throw error;
      const window = Math.min(cap, base * 2 ** (attempt - 1));
      const delay = Math.round(window / 2 + Math.random() * (window / 2 || 1));
      error instanceof DbFailure && options.onRetry?.(error, attempt);
      await sleep(delay);
    }
  }
  throw last;
}
