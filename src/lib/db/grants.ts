/**
 * Извлечение эффективных прав из моделей `#lib/db` (`grants(resource)`)
 * и чистая синхронная проверка прав субъекта (`checkGrants`, `forOwner`).
 *
 * Алгебра правил — конъюнктивная нормальная форма (КНФ):
 * - одиночная клауза `GrantClause = readonly string[]` — дизъюнкция (`ИЛИ`):
 *   субъект проходит её, если подходит хотя бы один атом (`'*'`, `'owner'` или имя роли);
 *   пустой массив `[]` означает полный запрет (`policy.deny()`);
 *   `null` означает неразмеченную произвольную функцию `(ctx) => …`;
 * - цепочка `GrantChain` и массив `readonly GrantSpec[]` — конъюнкция (`И`):
 *   субъект обязан пройти каждый элемент массива.
 */
import { extractMaskClause, extractPolicyClause } from "./acl";
import type { Field, Fields, Relations, Resource } from "./types";

export const CHAIN_BRAND: unique symbol = Symbol.for("modals-kit.db.grantChain");
export const BOUND_SPEC_BRAND: unique symbol = Symbol.for("modals-kit.db.boundGrantSpec");

export type GrantClause = readonly string[] | null;

export interface GrantChain extends ReadonlyArray<GrantClause> {
  readonly [CHAIN_BRAND]: true;
}

export interface BoundGrantSpec {
  readonly [BOUND_SPEC_BRAND]: true;
  readonly ownerId: string | null;
  readonly spec: GrantSpec;
}

export type GrantSpec =
  | readonly string[]
  | null
  | undefined
  | GrantChain
  | BoundGrantSpec
  | readonly GrantSpec[];

export interface GrantActor {
  readonly id: string | null;
  readonly permissions: readonly string[];
}

export interface CheckGrantsOptions {
  /** Владелец целевой записи по умолчанию для непривязанных клауз с маркером `'owner'`. */
  readonly ownerId?: string | null;
  /** Значение для неразмеченных кастомных функций (`null`); по умолчанию `false` (fail-closed). */
  readonly onUnknown?: boolean;
}

export type ModelActionKey =
  | "select"
  | "selectDeleted"
  | "insert"
  | "update"
  | "delete"
  | "hardDelete"
  | "restore";

export type ModelActionGrants = {
  readonly [K in ModelActionKey]: GrantChain;
};

export type ModelFieldGrants<F extends Fields = Fields> = {
  readonly [K in keyof F]: {
    readonly read: GrantChain;
    readonly create: GrantChain;
    readonly update: GrantChain;
  };
};

export type ModelRelationGrants<R extends Relations = Relations> = {
  readonly [K in keyof R]: GrantChain;
};

export type ModelGrants<F extends Fields = Fields, R extends Relations = Relations> = ModelActionGrants & {
  /** Эффективные права каждого поля с уже учтённой политикой операции модели. */
  readonly fields: ModelFieldGrants<F>;
  /** Чтение связей модели (`include` / `exists` по имени связи из `relations`). */
  readonly relations: ModelRelationGrants<R>;
  /** Чтение целевых моделей по внешним ключам `fields[k].db.references`. */
  readonly refs: Readonly<Record<string, GrantChain>>;
};

export function isGrantChain(v: unknown): v is GrantChain {
  return Array.isArray(v) && (v as unknown as Record<symbol, unknown>)[CHAIN_BRAND] === true;
}

export function isBoundGrantSpec(v: unknown): v is BoundGrantSpec {
  return !!v && typeof v === "object" && (v as Record<symbol, unknown>)[BOUND_SPEC_BRAND] === true;
}

/** Привязывает конкретный `ownerId` к поддереву правил внутри составного массива `GrantSpec`. */
export function forOwner(ownerId: string | null | undefined, spec: GrantSpec): BoundGrantSpec {
  const bound = {
    ownerId: ownerId ?? null,
    spec,
  } as unknown as BoundGrantSpec;
  Object.defineProperty(bound, BOUND_SPEC_BRAND, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return Object.freeze(bound);
}

const freezeClause = (c: GrantClause): GrantClause =>
  c === null ? null : Object.freeze([...new Set(c)]);

function makeChain(rawClauses: readonly GrantClause[]): GrantChain {
  const simplified: GrantClause[] = [];
  const seen = new Set<string>();

  for (const raw of rawClauses) {
    const c = freezeClause(raw);
    if (c !== null && c.length === 0) {
      // В конъюнкции хотя бы один полный запрет `[]` делает всю цепочку запрещённой.
      const denyOnly = [Object.freeze([] as string[])] as unknown as GrantChain;
      Object.defineProperty(denyOnly, CHAIN_BRAND, { value: true, enumerable: false });
      return Object.freeze(denyOnly);
    }
    if (c !== null && c.includes("*")) {
      continue;
    }
    const key = c === null ? "__null__" : [...c].sort().join("\0");
    if (!seen.has(key)) {
      seen.add(key);
      simplified.push(c);
    }
  }

  const finalClauses =
    simplified.length === 0 ? [Object.freeze(["*"])] : simplified;
  const chain = finalClauses as unknown as GrantChain;
  Object.defineProperty(chain, CHAIN_BRAND, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return Object.freeze(chain);
}

function unionClauses(clauses: readonly GrantClause[]): GrantClause {
  if (clauses.length === 0) return Object.freeze([]);
  const merged = new Set<string>();
  for (const c of clauses) {
    if (c === null) return null;
    if (c.includes("*")) return Object.freeze(["*"]);
    for (const atom of c) merged.add(atom);
  }
  return Object.freeze([...merged]);
}

function accessClausesForOp(
  r: Resource,
  op: "select" | "insert" | "update" | "delete",
): readonly GrantClause[] {
  if (!r.access) return [];
  const entries = Object.entries(r.access);
  if (entries.length === 0) return [];

  if (op === "select") {
    // На чтении `access` включается только если сам ключ передан в фильтре; базовый select не режет.
    return [];
  }

  if (op === "insert") {
    // На вставке обязательны и проверяются ВСЕ ключи `access`.
    const out: GrantClause[] = [];
    for (const [k, key] of entries) {
      if (key.kind === "owner") {
        out.push(key.ops.includes("insert") ? ["owner"] : []);
      } else {
        const ruleName = key.rules.insert;
        if (!ruleName) {
          out.push([]);
        } else {
          const target = r.fields[k]?.db?.references?.resource();
          if (target) {
            out.push(...grants(target).select);
            if (ruleName !== "select") {
              out.push(extractPolicyClause(target.policy?.[ruleName], false).clause);
            }
          }
        }
      }
    }
    return out;
  }

  // На `update` и `delete` достаточно хотя бы одного разрешающего ключа `access`.
  const options: GrantClause[] = [];
  for (const [k, key] of entries) {
    if (key.kind === "owner") {
      if (key.ops.includes(op)) options.push(["owner"]);
    } else {
      const ruleName = key.rules[op];
      if (ruleName) {
        const target = r.fields[k]?.db?.references?.resource();
        if (target) {
          const namedClause =
            ruleName === "select"
              ? extractPolicyClause(target.policy?.select, true).clause
              : extractPolicyClause(target.policy?.[ruleName], false).clause;
          // Если у цели одна клауза — берём пересечение/упрощение, иначе аппроксимируем правилом цели
          options.push(namedClause);
        }
      }
    }
  }
  return [unionClauses(options)];
}

const GRANTS_CACHE = new WeakMap<Resource, ModelGrants>();

/**
 * Извлекает полную карту эффективных прав доступа модели `Resource`:
 * `select`, `selectDeleted`, `insert`, `update`, `delete`, `hardDelete`, `restore`,
 * а также ленивые карты `fields`, `relations` и `refs` (ссылки `db.references`).
 * Результат мемоизируется в `WeakMap` по экземпляру ресурса (`O(1)` при повторных вызовах).
 */
export function grants<F extends Fields, R extends Relations>(
  resource: Resource<F, R>,
): ModelGrants<F, R> {
  const cached = GRANTS_CACHE.get(resource as unknown as Resource);
  if (cached) return cached as unknown as ModelGrants<F, R>;

  const r = resource as unknown as Resource;
  const fieldEntries = Object.entries(r.fields) as [string, Field<unknown>][];

  const readableMaskUnion = unionClauses(
    fieldEntries.map(([, f]) => extractMaskClause(f.read, true)),
  );

  const requiredCreateClauses: GrantClause[] = fieldEntries
    .filter(
      ([k, f]) =>
        Boolean(f.required) &&
        !f.generated &&
        !f.createValue &&
        !f.fill &&
        !f.db?.default &&
        k !== r.primaryKey &&
        k !== r.ownerField,
    )
    .map(([, f]) => extractMaskClause(f.create, true));

  const updatableFields = fieldEntries.filter(
    ([k, f]) =>
      !f.immutable &&
      !f.generated &&
      !f.createValue &&
      !f.fill &&
      k !== r.primaryKey &&
      k !== r.ownerField,
  );

  const updatableMaskUnion: GrantClause =
    updatableFields.length > 0
      ? unionClauses(updatableFields.map(([, f]) => extractMaskClause(f.update, true)))
      : Object.freeze([]);

  const selectPolicy = extractPolicyClause(r.policy?.select, true).clause;
  const insertPolicy = extractPolicyClause(r.policy?.insert, true).clause;
  const updatePolicy = extractPolicyClause(r.policy?.update, true).clause;
  const deletePolicy = extractPolicyClause(r.policy?.delete, true).clause;

  const selectChain = makeChain([
    selectPolicy,
    readableMaskUnion,
    ...accessClausesForOp(r, "select"),
  ]);

  const insertChain = makeChain([
    insertPolicy,
    ...requiredCreateClauses,
    ...accessClausesForOp(r, "insert"),
  ]);

  const updateChain = makeChain([
    updatePolicy,
    updatableMaskUnion,
    ...accessClausesForOp(r, "update"),
  ]);

  const deleteChain = makeChain([
    deletePolicy,
    ...accessClausesForOp(r, "delete"),
  ]);

  let selectDeletedChain: GrantChain;
  let hardDeleteChain: GrantChain;
  let restoreChain: GrantChain;

  if (r.softDelete) {
    const readDeletedClause = extractMaskClause(r.softDelete.readDeleted, false);
    const hardDeletePolicy = extractPolicyClause(
      r.policy?.hardDelete ?? r.policy?.delete,
      true,
    ).clause;
    const restorePolicy = extractPolicyClause(
      r.policy?.restore ?? r.policy?.hardDelete ?? r.policy?.delete,
      true,
    ).clause;

    // Чтение удалённых строго требует И живой `select`, И модификатор `readDeleted`.
    selectDeletedChain = makeChain([...selectChain, readDeletedClause]);
    hardDeleteChain = makeChain([
      hardDeletePolicy,
      readDeletedClause,
      ...accessClausesForOp(r, "delete"),
    ]);
    restoreChain = makeChain([
      restorePolicy,
      readDeletedClause,
      ...accessClausesForOp(r, "delete"),
    ]);
  } else {
    selectDeletedChain = makeChain([[]]);
    hardDeleteChain = deleteChain;
    restoreChain = makeChain([[]]);
  }

  let fieldsCache: ModelFieldGrants<F> | undefined;
  let relationsCache: ModelRelationGrants<R> | undefined;
  let refsCache: Readonly<Record<string, GrantChain>> | undefined;

  const out: Record<string, GrantChain> = {
    select: selectChain,
    selectDeleted: selectDeletedChain,
    insert: insertChain,
    update: updateChain,
    delete: deleteChain,
    hardDelete: hardDeleteChain,
    restore: restoreChain,
  };

  Object.defineProperties(out, {
    fields: {
      enumerable: false,
      configurable: false,
      get(): ModelFieldGrants<F> {
        if (!fieldsCache) {
          const built: Record<string, { read: GrantChain; create: GrantChain; update: GrantChain }> = {};
          for (const [k, f] of fieldEntries) {
            const readMask = extractMaskClause(f.read, true);
            const canCreateField = !f.generated && !f.createValue && !f.fill && k !== r.primaryKey && k !== r.ownerField;
            const canUpdateField = canCreateField && !f.immutable;
            built[k] = Object.freeze({
              read: makeChain([...selectChain, readMask]),
              create: canCreateField
                ? makeChain([insertPolicy, extractMaskClause(f.create, true), ...accessClausesForOp(r, "insert")])
                : makeChain([[]]),
              update: canUpdateField
                ? makeChain([updatePolicy, extractMaskClause(f.update, true), ...accessClausesForOp(r, "update")])
                : makeChain([[]]),
            });
          }
          fieldsCache = Object.freeze(built) as unknown as ModelFieldGrants<F>;
        }
        return fieldsCache;
      },
    },
    relations: {
      enumerable: false,
      configurable: false,
      get(): ModelRelationGrants<R> {
        if (!relationsCache) {
          const built: Record<string, GrantChain> = {};
          for (const [name, rel] of Object.entries(r.relations ?? {})) {
            const localRead = extractMaskClause(r.fields[rel.localField]?.read, true);
            const targetSelect = grants(rel.resource).select;
            built[name] = makeChain([...selectChain, localRead, ...targetSelect]);
          }
          relationsCache = Object.freeze(built) as unknown as ModelRelationGrants<R>;
        }
        return relationsCache;
      },
    },
    refs: {
      enumerable: false,
      configurable: false,
      get(): Readonly<Record<string, GrantChain>> {
        if (!refsCache) {
          const built: Record<string, GrantChain> = {};
          for (const [k, f] of fieldEntries) {
            const refFn = f.db?.references?.resource;
            if (typeof refFn === "function") {
              built[k] = grants(refFn()).select;
            }
          }
          refsCache = Object.freeze(built);
        }
        return refsCache;
      },
    },
  });

  const frozen = Object.freeze(out) as unknown as ModelGrants<F, R>;
  GRANTS_CACHE.set(r, frozen as unknown as ModelGrants);
  return frozen;
}

/* ── Вычисление checkGrants ──────────────────────────────────────────────── */

function evalClause(
  actorId: string | null,
  perms: readonly string[],
  clause: readonly string[],
  ownerId: string | null,
): boolean {
  if (clause.length === 0) return false;
  for (const atom of clause) {
    if (atom === "*") return true;
    if (atom === "owner") {
      if (actorId !== null && ownerId !== null && actorId === ownerId) return true;
    } else if (perms.includes(atom)) {
      return true;
    }
  }
  return false;
}

function isStringClause(arr: readonly unknown[]): arr is readonly string[] {
  for (const item of arr) {
    if (typeof item !== "string") return false;
  }
  return true;
}

function evalSpec(
  actorId: string | null,
  perms: readonly string[],
  spec: GrantSpec,
  ownerId: string | null,
  onUnknown: boolean,
): boolean {
  if (spec === undefined) return false;
  if (spec === null) return onUnknown;
  if (isBoundGrantSpec(spec)) {
    return evalSpec(actorId, perms, spec.spec, spec.ownerId, onUnknown);
  }
  if (!Array.isArray(spec)) return false;
  if (spec.length === 0) return false;

  if (!isGrantChain(spec) && isStringClause(spec)) {
    return evalClause(actorId, perms, spec, ownerId);
  }

  for (const item of spec) {
    if (!evalSpec(actorId, perms, item as GrantSpec, ownerId, onUnknown)) {
      return false;
    }
  }
  return true;
}

export function isGrantSpecInput(value: unknown): value is GrantSpec {
  return value === null || value === undefined || Array.isArray(value) || isBoundGrantSpec(value);
}

/**
 * Сравнивает права субъекта `actor` с требуемыми правами `spec` (или словарём действий `specMap`).
 *
 * - Если передано одиночное требование `GrantSpec` (массив ролей `['admin', 'test']`,
 *   правило модели `grants(auth).select` или составной массив связок `[grants(a).select, grants(b).insert]`),
 *   возвращает `boolean`.
 * - Если передан словарь `{ action: GrantSpec }` (например `grants(block)` или `configRow.schema`),
 *   возвращает объект булевых флагов `{ readonly [K]: boolean }` по тем же ключам.
 */
export function checkGrants(
  actor: GrantActor | null | undefined,
  spec: GrantSpec,
  options?: CheckGrantsOptions,
): boolean;
export function checkGrants<T extends Record<string, GrantSpec>>(
  actor: GrantActor | null | undefined,
  specMap: T,
  options?: CheckGrantsOptions,
): { readonly [K in keyof T]: boolean };
export function checkGrants(
  actor: GrantActor | null | undefined,
  specOrMap: GrantSpec | Record<string, GrantSpec>,
  options?: CheckGrantsOptions,
): boolean | Record<string, boolean> {
  const actorId = actor?.id ?? null;
  const perms = actor?.permissions ?? [];
  const ownerId = options?.ownerId ?? null;
  const onUnknown = options?.onUnknown ?? false;

  if (isGrantSpecInput(specOrMap)) {
    return evalSpec(actorId, perms, specOrMap, ownerId, onUnknown);
  }

  const out: Record<string, boolean> = {};
  for (const [key, spec] of Object.entries(specOrMap)) {
    out[key] = evalSpec(actorId, perms, spec, ownerId, onUnknown);
  }
  return Object.freeze(out);
}
