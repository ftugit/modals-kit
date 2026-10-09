import { DbFailure } from "../errors";
import type { Database } from "../types";

/**
 * Разделитель SQL по операторам. В источнике было `text.split(';')`, что
 * ломалось на `;` внутри строк, комментариев и `$$…$$` — то есть
 * миграция с `CREATE FUNCTION` или `DEFAULT 'a;b'` портила файл молча.
 * Здесь — конечный автомат: строки, кавычки-идентификаторы, комментарии,
 * dollar-quoted блоки.
 */
export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i]!;
    const next = sql[i + 1];
    if (c === "-" && next === "-") {
      const end = sql.indexOf("\n", i);
      i = end === -1 ? sql.length : end;
      continue;
    }
    if (c === "/" && next === "*") {
      const end = sql.indexOf("*/", i + 2);
      i = end === -1 ? sql.length : end + 1;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      const quote = c;
      current += c;
      for (i++; i < sql.length; i++) {
        const ch = sql[i]!;
        current += ch;
        if (ch === "\\" && quote !== "`") {
          i++;
          if (i < sql.length) current += sql[i]!;
          continue;
        }
        if (ch === quote) {
          if (sql[i + 1] === quote) {
            current += sql[++i]!;
            continue;
          }
          break;
        }
      }
      continue;
    }
    if (c === "$") {
      const tag = /^\$[A-Za-z_0-9]*\$/.exec(sql.slice(i))?.[0];
      if (tag) {
        // dollar-quoted блок (тело функции) может содержать ; и кавычки —
        // он целиком относится к текущему оператору.
        const close = sql.indexOf(tag, i + tag.length);
        const last = close === -1 ? sql.length - 1 : close + tag.length - 1;
        current += sql.slice(i, last + 1);
        i = last;
        continue;
      }
    }
    if (c === ";") {
      if (current.trim()) statements.push(current.trim());
      current = "";
      continue;
    }
    current += c;
  }
  if (current.trim()) statements.push(current.trim());
  return statements;
}

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
