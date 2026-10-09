/**
 * Границы пакета (заменяют `tooling/vite/db.mjs` источника: SvelteKit сам
 * запрещает импорт `$lib/server` в клиент, а здесь проверяется остальное —
 * то, что нельзя выразить типами).
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { it } from "vitest";

/**
 * Границы слоя. Пути — уже не пакета, а приложения: `src/lib/db/**`, поэтому
 * «ядро» = всё, кроме sveltekit-слоя, тестовых фикстур, проб и опционального
 * zod-модуля.
 */
const LIB = "src/lib/db";
const walk = (d: string): string[] =>
  readdirSync(d).flatMap((e) => (statSync(join(d, e)).isDirectory() ? walk(join(d, e)) : [join(d, e)]));
const isTs = (f: string) => f.endsWith(".ts");
const core = walk(LIB)
  .filter(
    (f) => !/(^|\/)(sveltekit|testing|test|probes|docs|migrations)\//.test(f) && !f.endsWith("zod.ts"),
  )
  .filter(isTs);
const kit = walk(join(LIB, "sveltekit")).filter((f) => !f.endsWith("node.ts")).filter(isTs);
const check = (name: string, fn: () => void) => it(name, fn);
const importsOf = (file: string) =>
  [...readFileSync(file, "utf8").matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map((m) => m[1]!);

check("ядро не знает про HTTP-фреймворки, zod и node:*", () => {
  for (const file of core)
    for (const spec of importsOf(file))
      assert.ok(
        !/^(hono|zod|@sveltejs|@hono|node:)/.test(spec),
        `${file}: неожиданный импорт ${spec}`,
      );
});
check("ядро не зависит от SvelteKit-слоя (направление зависимостей однонаправлено)", () => {
  for (const file of core)
    assert.ok(!importsOf(file).some((s) => s.includes("sveltekit")), file);
});
check("barrel не реэкспортирует драйверы (клиентская/edge сборка не тянет pg/PGlite)", () => {
  const barrel = readFileSync("src/lib/db/index.ts", "utf8");
  assert.ok(!/adapters\//.test(barrel), "index.ts не должен экспортировать адаптеры");
  assert.ok(/Драйверы намеренно НЕ реэкспортируются/.test(barrel), "намерение должно быть описано");
});
check("универсальный sveltekit-вход не тянет node-only (Workers-safe)", () => {
  for (const file of kit) {
    const specs = importsOf(file);
    assert.ok(!specs.some((s) => /^node:|pglite|^pg$|adapters\/(pg|pglite|hyperdrive)/.test(s)), `${file}: ${specs.join(", ")}`);
  }
});
check("каждый FailureKind имеет HTTP-статус", async () => {
  const { FAILURE_STATUS } = await import("../sveltekit/errors");
  const source = readFileSync("src/lib/db/errors.ts", "utf8");
  const kinds = /export type FailureKind =([\s\S]*?);/.exec(source)![1]!
    .split("|").map((x) => x.trim().replace(/"/g, "")).filter(Boolean);
  assert.ok(kinds.length >= 10, "не нашёл kinds");
  for (const kind of kinds) {
    const status = (FAILURE_STATUS as Record<string, number>)[kind];
    assert.ok(status >= 400 && status <= 599, kind + " → " + status);
  }
});
check("схема поля — только Standard Schema, без vendor-типов", () => {
  const types = readFileSync("src/lib/db/types.ts", "utf8");
  assert.ok(/StandardSchemaV1/.test(types) && !/from "zod"/.test(types));
});
