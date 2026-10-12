import { DbFailure } from "../errors";
import type { Database } from "../types";

// Разделитель живёт в ядре (им пользуется и `defineSchema`); здесь — тот же экспорт,
// что и раньше, чтобы `#lib/db/sveltekit/index.js` не менял API.
export { splitSqlStatements } from "../query/split";
import { splitSqlStatements } from "../query/split";

/**
 * Миграции НЕ запускаются при старте приложения (как в источнике).
 * Требуется транзакционный адаптер; вызывающий код сам решает, когда и с каким
 * файлом запускать, и обязан держать явное подтверждение вне этого модуля.
 */
export async function applyMigrationText(
  db: Database,
  sql: string,
  options: { statements?: readonly string[] } = {},
): Promise<{ applied: number }> {
  if (!db.driver.capabilities.transactions)
    throw new DbFailure("unsupported", undefined, [
      "schema migration needs a transactional adapter",
    ]);
  const texts = options.statements ?? splitSqlStatements(sql);
  if (!texts.length) throw new DbFailure("validation", undefined, ["empty migration"]);
  await db.transaction(async (tx) => {
    for (const text of texts) await tx.query({ text });
  });
  return { applied: texts.length };
}
