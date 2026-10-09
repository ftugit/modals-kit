import type { PGlite } from "@electric-sql/pglite";
import type { Driver, Row, Statement } from "../types";
import { result, scope, transactionalCapabilities, beginSQL } from "./shared";
export function pgliteAdapter(db: PGlite): Driver {
  return {
    capabilities: transactionalCapabilities,
    async query<T extends Row>(s: Statement) {
      const r = await db.query<Row>(s.text, [...(s.values ?? [])]);
      return result<T>(r.rows, r.affectedRows);
    },
    transaction(fn, options) {
      beginSQL(options, transactionalCapabilities);
      return db.transaction(async (tx) => {
        if (options?.isolation)
          await tx.query(
            "SET TRANSACTION ISOLATION LEVEL " +
              options.isolation.toUpperCase(),
          );
        if (options?.readOnly) await tx.query("SET TRANSACTION READ ONLY");
        return scope(
          async (s) => {
            const r = await tx.query<Row>(s.text, [...(s.values ?? [])]);
            return result(r.rows, r.affectedRows);
          },
          transactionalCapabilities,
          fn,
        );
      });
    },
  };
}
