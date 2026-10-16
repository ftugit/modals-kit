/**
 * Цепочка удаления (docs/design/model-automation.md §10). Ссылка-принадлежность
 * (`references: { resource, chain: true }`) значит «строка живёт только вместе с целью».
 * `chain(ctx, id)` собирает записи цепочки и права на их удаление, ничего не удаляя;
 * `plan.delete({ force })` собирает их заново в транзакции с блокировкой строк, проверяет и
 * удаляет с конца, корень — последним.
 */
import { DbFailure, fail } from "./errors";
import { col, filterSQL, projection, Sql, table } from "./query/sql";
import { applicable, originOf, withoutPaths } from "./clone";
import { rawResource } from "./raw";
import { accessSQL, rule, softDeleteAssignment } from "./rules";
import { grants, timestampField, validateField } from "./validation";
import type { DataContext, Database, Fields, Resource, Row } from "./types";

/** Связь «родитель → ребёнок» по полю ребёнка. */
interface Link {
  readonly parent: Resource;
  readonly child: Resource;
  readonly field: string;
}
/** Что `createDb({ resources })` знает о цепочках: связи от родителя и порядок моделей. */
export interface ChainKit {
  readonly links: ReadonlyMap<Resource, readonly Link[]>;
  /** Модель → место в порядке «родители раньше детей». */
  readonly rank: ReadonlyMap<Resource, number>;
  readonly maxRows: number;
}
export const CHAIN_KIT = Symbol("modals-kit.db.chain");

/**
 * Связи из `references.chain` моделей списка. Круг принадлежности между разными моделями
 * (A ⊂ B ⊂ A) — ошибка объявления; ссылка модели на саму себя (дерево) допустима.
 */
export function chainKit(resources: readonly Resource[], maxRows: number): ChainKit {
  if (!Array.isArray(resources)) fail("validation", undefined, ["createDb: resources — массив моделей"]);
  const links = new Map<Resource, Link[]>();
  const models = new Set<Resource>();
  const issues: string[] = [];
  for (const child of resources) {
    if (!child || typeof child !== "object" || !child.fields) {
      issues.push("createDb: resources — модели defineResource");
      continue;
    }
    models.add(child);
    for (const [field, f] of Object.entries(child.fields as Fields)) {
      const ref = f.db?.references;
      if (!ref?.chain) continue;
      const parent = ref.resource();
      if ((ref.field ?? parent.primaryKey) !== parent.primaryKey)
        issues.push(`${child.key}.${field}: ссылка-принадлежность (chain) — только на primaryKey ${parent.key}`);
      models.add(parent);
      const list = links.get(parent) ?? [];
      list.push({ parent, child, field });
      links.set(parent, list);
    }
  }
  if (issues.length) fail("validation", undefined, issues);
  // порядок «родители раньше детей» (Кан); оставшиеся — круг
  const incoming = new Map<Resource, number>([...models].map((m) => [m, 0]));
  for (const list of links.values()) for (const l of list) if (l.child !== l.parent) incoming.set(l.child, incoming.get(l.child)! + 1);
  const ready = [...models].filter((m) => !incoming.get(m));
  const rank = new Map<Resource, number>();
  while (ready.length) {
    const m = ready.shift()!;
    rank.set(m, rank.size);
    for (const l of links.get(m) ?? [])
      if (l.child !== m) {
        incoming.set(l.child, incoming.get(l.child)! - 1);
        if (!incoming.get(l.child)) ready.push(l.child);
      }
  }
  if (rank.size !== models.size)
    fail("validation", undefined, [
      `createDb: круг принадлежности (chain) между моделями: ${[...models].filter((m) => !rank.has(m)).map((m) => m.key).join(", ")}`,
    ]);
  return { links, rank, maxRows };
}

/** Модель звена: выключенное у корня переходит на звено (что ему подходит), сырой корень — сырые звенья. */
function linkModel(root: Resource, child: Resource): Resource {
  const from = originOf(root);
  if (from.raw) return rawResource(child);
  const off = applicable(child, from.off);
  return off.length ? withoutPaths(child, off) : child;
}
const isRaw = (m: Resource) => originOf(m).raw;

/** Условие «этот ctx может удалить строку» модели — SQL. */
async function deletable(db: Database, m: Resource, ctx: DataContext, s: Sql): Promise<string> {
  return isRaw(m) ? "TRUE" : `(${await filterSQL(m, ctx, rule(m, "delete", ctx), s, db.limits, true)}) AND (${await accessSQL(m, "delete", ctx, s, db.limits)})`;
}
const liveSQL = (m: Resource) => (m.softDelete && !isRaw(m) ? ` AND ${col(m, m.softDelete.field)} IS NULL` : "");

export interface ChainLink {
  /** Ключ модели звена. */
  readonly model: string;
  /** Путь от корня: ключи моделей. */
  readonly path: readonly string[];
  readonly ids: readonly unknown[];
  /** Сколько из них этот ctx может удалить. */
  readonly allowed: number;
  readonly total: number;
  /** Модель звена умеет мягкое удаление. */
  readonly soft: boolean;
}
export interface ChainPlan {
  readonly root: { readonly model: string; readonly id: unknown; readonly allowed: boolean; readonly soft: boolean };
  readonly links: readonly ChainLink[];
  /**
   * Удалить корень и цепочку в одной транзакции: собрать заново с блокировкой строк,
   * проверить, удалить с конца, корень — последним. Мягкий корень — все звенья мягко (не
   * умеет — `unsupported` с `{ model, path, count }`); `force` или корень без мягкого
   * удаления — всё навсегда. Не хватает прав — `forbidden` с `{ model, path, count }`.
   */
  delete(options?: { force?: boolean }): Promise<{ root: Row; links: readonly { model: string; count: number }[] }>;
}

interface Entry {
  origin: Resource;
  model: Resource;
  path: string[];
  ids: unknown[];
  /** Уровни сверху вниз: дерево удаляется с нижних. */
  batches: unknown[][];
  allowed: number;
  total: number;
}

/**
 * `hard` — режим удаления; `"view"` — для просмотра: мягкий, если корень удаляется мягко и
 * ещё жив, иначе (корень уже мягко удалён — осталось только навсегда) жёсткий.
 */
async function collect(dbx: Database, kit: ChainKit, root: Resource, ctx: DataContext, id: unknown, mode: boolean | "view", lock: boolean) {
  const rootOrigin = originOf(root).origin;
  const pk = await validateField(root.fields[root.primaryKey], id, root.primaryKey);
  const s = new Sql();
  const marked = !!root.softDelete && !isRaw(root);
  const withDeleted = mode !== false && marked && grants(root.softDelete!.readDeleted, ctx);
  const head = (
    await dbx.query(
      s.statement(
        `SELECT (${await deletable(dbx, root, ctx, s)}) AS ok${marked ? `, ${col(root, root.softDelete!.field)} IS NOT NULL AS gone` : ""} FROM ${table(root)} WHERE ${col(root, root.primaryKey)} = ${s.param(pk)}${withDeleted ? "" : liveSQL(root)}${lock ? " FOR UPDATE" : ""}`,
      ),
    )
  ).rows[0];
  if (!head) fail("not_found");
  const gone = head.gone === true;
  const hard = mode === "view" ? !marked || gone : mode;
  const entries = new Map<Resource, Entry>();
  const seen = new Map<Resource, Set<string>>([[rootOrigin, new Set([JSON.stringify(pk)])]]);
  const queue: { origin: Resource; ids: unknown[]; path: string[] }[] = [{ origin: rootOrigin, ids: [pk], path: [root.key] }];
  let rows = 0;
  while (queue.length) {
    const level = queue.shift()!;
    for (const link of kit.links.get(level.origin) ?? []) {
      const model = linkModel(root, link.child);
      const q = new Sql();
      const ok = await deletable(dbx, model, ctx, q);
      const found = (
        await dbx.query(
          q.statement(
            `SELECT ${projection(model, [model.primaryKey])}, (${ok}) AS ok FROM ${table(model)} WHERE ${col(model, link.field)} = ANY(${q.param(level.ids)})${hard ? "" : liveSQL(model)}${lock ? " FOR UPDATE" : ""}`,
          ),
        )
      ).rows;
      const known = seen.get(link.child) ?? new Set<string>();
      seen.set(link.child, known);
      const fresh = found.filter((x) => !known.has(JSON.stringify(x[model.primaryKey])));
      if (!fresh.length) continue;
      rows += fresh.length;
      if (rows > kit.maxRows) fail("unsupported", undefined, [`цепочка удаления больше ${kit.maxRows} строк`]);
      const path = [...level.path, link.child.key];
      const entry = entries.get(link.child) ?? { origin: link.child, model, path, ids: [], batches: [], allowed: 0, total: 0 };
      entries.set(link.child, entry);
      const ids = fresh.map((x) => x[model.primaryKey]);
      for (const x of fresh) known.add(JSON.stringify(x[model.primaryKey]));
      entry.ids.push(...ids);
      entry.batches.push(ids);
      entry.total += fresh.length;
      entry.allowed += fresh.filter((x) => x.ok === true).length;
      if (path.length > 64) fail("unsupported", undefined, [`${path.slice(0, 4).join(" → ")} …: цепочка глубже 64 уровней`]);
      queue.push({ origin: link.child, ids, path });
    }
  }
  return { allowed: head.ok === true, gone, pk, entries: [...entries.values()] };
}

/** Мягко ли удаляет корень по умолчанию. */
const softRoot = (root: Resource) => !!root.softDelete && !isRaw(root);

export async function chainPlan(db: Database, root: Resource, ctx: DataContext, id: unknown): Promise<ChainPlan> {
  const kit = (db as unknown as { [CHAIN_KIT]?: ChainKit })[CHAIN_KIT];
  if (!kit) fail("unsupported", undefined, ["chain: передайте список моделей в createDb({ resources })"]);
  const view = await collect(db, kit, root, ctx, id, "view", false);
  const plan: ChainPlan = Object.freeze({
    root: Object.freeze({ model: root.key, id: view.pk, allowed: view.allowed, soft: softRoot(root) && !view.gone }),
    links: Object.freeze(
      view.entries.map((e) =>
        Object.freeze({ model: e.origin.key, path: Object.freeze(e.path), ids: Object.freeze(e.ids), allowed: e.allowed, total: e.total, soft: !!e.model.softDelete && !isRaw(e.model) }),
      ),
    ),
    delete: (options?: { force?: boolean }) =>
      db.guard(async () => {
        if (options !== undefined && (typeof options !== "object" || Object.keys(options).some((k) => k !== "force")))
          fail("validation", undefined, ["delete: опции { force?: boolean }"]);
        if (!db.driver.capabilities.transactions) fail("unsupported");
        const hard = options?.force === true || !softRoot(root);
        return db.transaction((tx) => execute(tx, kit, root, ctx, view.pk, hard));
      }),
  });
  return plan;
}

async function execute(tx: Database, kit: ChainKit, root: Resource, ctx: DataContext, id: unknown, hard: boolean) {
  const found = await collect(tx, kit, root, ctx, id, hard, true);
  if (!found.allowed) throw new DbFailure("forbidden", { model: root.key, path: [root.key], count: 1 });
  for (const e of found.entries) {
    const soft = !!e.model.softDelete && !isRaw(e.model);
    if (!hard && !soft) throw new DbFailure("unsupported", { model: e.origin.key, path: e.path, count: e.total });
    if (e.allowed < e.total) throw new DbFailure("forbidden", { model: e.origin.key, path: e.path, count: e.total - e.allowed });
  }
  const order = [...found.entries].sort((a, b) => (kit.rank.get(b.origin) ?? 0) - (kit.rank.get(a.origin) ?? 0));
  const out: { model: string; count: number }[] = [];
  for (const e of order) {
    // навсегда — клоном без мягкого удаления; хуки, время и права — модели звена
    const model = hard && e.model.softDelete && !isRaw(e.model) ? withoutPaths(e.model, [deletedPath(e.model)]) : e.model;
    const perRow = !isRaw(model) && !!(model.hooks?.beforeWrite || model.hooks?.afterWrite || model.hooks?.afterCommit || model.validateFinal);
    for (const batch of [...e.batches].reverse()) {
      if (perRow) {
        for (const one of batch) await tx.resource(model).delete(ctx, one);
        continue;
      }
      const s = new Sql();
      const ok = await deletable(tx, model, ctx, s);
      const match = `${col(model, model.primaryKey)} = ANY(${s.param(batch)}) AND (${ok})`;
      const text = model.softDelete && !isRaw(model)
        ? `UPDATE ${table(model)} SET ${await softDeleteAssignment(model, s, ctx)} WHERE ${match}${liveSQL(model)}`
        : `DELETE FROM ${table(model)} WHERE ${match}`;
      const done = await tx.query({ ...s.statement(text), ...(ctx.signal ? { signal: ctx.signal } : {}) });
      if (done.rowCount !== batch.length) throw new DbFailure("conflict", { model: e.origin.key, path: e.path, count: batch.length - done.rowCount });
    }
    out.push({ model: e.origin.key, count: e.total });
  }
  const row = await tx.resource(root).delete(ctx, id, hard && softRoot(root) ? { force: true } : undefined);
  return { root: row, links: Object.freeze(out.reverse()) };
}

/** Путь схемы мягкого удаления модели: `timestamps.deletedAt` или ручной `softDelete`. */
const deletedPath = (m: Resource) => (timestampField(m, "deletedAt") ? "timestamps.deletedAt" : "softDelete");
