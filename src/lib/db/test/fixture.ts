/**
 * Точка входа перенесённых проверок SolidHono: те же имена экспорта, что у
 * `test/fixtures/db-lib.ts` источника, поэтому тела тестов
 * (`test/ported/*.test.mjs`) не переписываются — меняется только способ
 * получить модуль (tsx вместо vite-сборки фикстуры).
 */
export * from "../index";
export { pgliteAdapter } from "../adapters/pglite";
export { pgAdapter } from "../adapters/pg";
export { authors, blogs } from"../resources";
export { createProbeRest } from"../probe-rest";
export { BodyTooLarge, readBoundedBody } from "../sveltekit/query";
// Опциональный путь: тесты источника объявляют несколько схем через zod.
export { z } from "../zod";
export { splitSqlStatements } from "../sveltekit/migrate";
import { authors, blogs } from"../resources";
import type { Database } from "../types";
export function createProbeApi(db: Database) {
  return { author: db.resource(authors), blog: db.resource(blogs) };
}
