/**
 * Декларативный конструктор прав модели (`defineAcl`) и страж инвариантов ACL.
 *
 * Решает две задачи при объявлении `defineResource`:
 * 1. Генерирует согласованный набор правил `policy.{select, insert, update, delete, hardDelete, restore}`
 *    и список `timestamps.deletedAt.readDeleted` из одного места без ручного дублирования ролей.
 * 2. Проверяет аксиомы целостности прав (`validateResourceAcl`):
 *    - любое пишущее/удаляющее право обязано иметь живое чтение (`select`);
 *    - `hardDelete` не может быть шире мягкого `delete`;
 *    - в `update` не висят «мёртвые» роли без открытых им изменяемых полей;
 *    - `update` без `delete` законен только тогда, когда у модели есть защищённые поля,
 *      не позволяющие затереть запись вместо удаления;
 *    - `softDelete` и `deleted` требуют `timestamps.deletedAt` (или `softDelete` модели).
 */
import { fail } from "./errors";
import { policy, readPolicyMeta, type PolicyMeta } from "./policy";
import type { DataContext, Field, Filter, Grant, Policy, Resource, Row } from "./types";

export const ACL_BRAND: unique symbol = Symbol.for("modals-kit.db.aclDefinition");
export const SKIP_ACL_GUARD: unique symbol = Symbol.for("modals-kit.db.skipAclGuard");

export type AclOwnerCapability = "read" | "update" | "softDelete" | "edit";
export type AclCapability = AclOwnerCapability | "insert" | "deleted";

export type AclRuleName =
  | "insert-implies-select"
  | "update-implies-select"
  | "delete-implies-select"
  | "hard-delete-implies-delete"
  | "update-has-writable-field"
  | "update-without-delete-needs-protected-field"
  | "soft-delete-requires-deleted-at";

const KNOWN_ANOMALIES: ReadonlySet<string> = new Set<AclRuleName>([
  "insert-implies-select",
  "update-implies-select",
  "delete-implies-select",
  "hard-delete-implies-delete",
  "update-has-writable-field",
  "update-without-delete-needs-protected-field",
  "soft-delete-requires-deleted-at",
]);

const KNOWN_OWNER_CAPS: ReadonlySet<string> = new Set<AclOwnerCapability>([
  "read",
  "update",
  "softDelete",
  "edit",
]);

export interface AclInput {
  /** Публичное чтение живых записей (`policy.publicRows()`). */
  readonly publicRead?: boolean;
  /** Возможности владельца строки (`ctx.principal.id === row[field]`). */
  readonly owner?: {
    readonly field: string;
    readonly can: readonly AclOwnerCapability[];
  };
  /** Только чтение живых записей (`select`). */
  readonly read?: readonly string[];
  /** Чтение живых + создание (`select` + `insert`). */
  readonly insert?: readonly string[];
  /** Чтение живых + изменение открытых маской полей БЕЗ права удаления (`select` + `update`). */
  readonly update?: readonly string[];
  /** Чтение живых + мягкое удаление БЕЗ права полного стирания (`select` + `delete`). */
  readonly softDelete?: readonly string[];
  /** Чтение живых + изменение + удаление + право на `hardDelete`/`restore` в связке с `deleted`. */
  readonly edit?: readonly string[];
  /**
   * Модификатор доступа к удалённым строкам (`softDelete.readDeleted`).
   * Сам по себе чтения модели не даёт: `includeDeleted` требует `select` И `deleted`,
   * а `hard: true` / `restore` требуют `edit` (`hardDelete`) И `deleted`.
   */
  readonly deleted?: readonly string[];
  /** Дополнительные SQL-условия поверх сгенерированных базовых правил. */
  readonly extend?: {
    readonly select?: (base: Filter, ctx: DataContext) => Filter;
    readonly update?: (base: Filter, ctx: DataContext) => Filter;
    readonly delete?: (base: Filter, ctx: DataContext) => Filter;
  };
  /** Точечное подавление отдельных аксиом стража для уникальных моделей. */
  readonly allowAnomalies?: readonly AclRuleName[];
}

export interface AclRoles {
  readonly select: readonly string[];
  readonly insert: readonly string[];
  readonly update: readonly string[];
  readonly delete: readonly string[];
  readonly hardDelete: readonly string[];
  readonly edit: readonly string[];
  readonly deleted: readonly string[];
}

export interface AclDefinition {
  readonly [ACL_BRAND]: true;
  readonly input: AclInput;
  readonly roles: AclRoles;
}

const uniq = (list: readonly string[] | undefined): readonly string[] => {
  if (!list?.length) return Object.freeze([]);
  const out: string[] = [];
  for (const raw of list) {
    if (typeof raw !== "string" || !raw.trim() || raw === "*" || raw === "owner") {
      fail("validation", undefined, [
        `defineAcl: роль обязана быть непустой строкой без служебных маркеров '*'/'owner' (получено: ${String(raw)})`,
      ]);
    }
    if (!out.includes(raw)) out.push(raw);
  }
  return Object.freeze(out);
};

export function isAclDefinition(v: unknown): v is AclDefinition {
  return !!v && typeof v === "object" && (v as Record<symbol, unknown>)[ACL_BRAND] === true;
}

/**
 * Собирает декларативное описание прав модели. Возвращает объект `AclDefinition`,
 * который передаётся в `defineResource({ ..., acl })`, а его готовые списки `acl.roles.*`
 * можно напрямую переиспользовать в масках полей (`create` / `update` / `read`).
 */
export function defineAcl(input: AclInput): AclDefinition {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    fail("validation", undefined, ["defineAcl: ожидается объект описания прав"]);
  }
  const issues: string[] = [];
  if (input.owner !== undefined) {
    if (
      !input.owner ||
      typeof input.owner !== "object" ||
      typeof input.owner.field !== "string" ||
      !input.owner.field.trim()
    ) {
      issues.push("defineAcl: owner.field обязан быть непустым именем поля модели");
    }
    if (!Array.isArray(input.owner?.can) || input.owner.can.length === 0) {
      issues.push("defineAcl: owner.can обязан быть непустым списком возможностей");
    } else {
      for (const c of input.owner.can) {
        if (!KNOWN_OWNER_CAPS.has(c)) {
          issues.push(
            `defineAcl: неизвестная возможность owner.can «${String(c)}» (допустимы: read, update, softDelete, edit)`,
          );
        }
      }
    }
  }
  if (input.allowAnomalies !== undefined) {
    if (!Array.isArray(input.allowAnomalies)) {
      issues.push("defineAcl: allowAnomalies обязан быть массивом кодов аксиом");
    } else {
      for (const a of input.allowAnomalies) {
        if (!KNOWN_ANOMALIES.has(a)) {
          issues.push(`defineAcl: неизвестный код allowAnomalies «${String(a)}»`);
        }
      }
    }
  }
  if (input.extend !== undefined) {
    if (!input.extend || typeof input.extend !== "object" || Array.isArray(input.extend)) {
      issues.push("defineAcl: extend обязан быть объектом { select?, update?, delete? }");
    } else {
      for (const [k, fn] of Object.entries(input.extend)) {
        if (!["select", "update", "delete"].includes(k)) {
          issues.push(`defineAcl: extend.${k} не поддерживается (есть select, update, delete)`);
        } else if (fn !== undefined && typeof fn !== "function") {
          issues.push(`defineAcl: extend.${k} обязан быть функцией (base, ctx) => Filter`);
        }
      }
    }
  }
  if (issues.length) fail("validation", undefined, issues);

  const readRoles = uniq(input.read);
  const insertRoles = uniq(input.insert);
  const updateOnlyRoles = uniq(input.update);
  const softDeleteRoles = uniq(input.softDelete);
  const editRoles = uniq(input.edit);
  const deletedRoles = uniq(input.deleted);

  const updateRoles = uniq([...updateOnlyRoles, ...editRoles]);
  const deleteRoles = uniq([...softDeleteRoles, ...editRoles]);
  const hardDeleteRoles = editRoles;
  const selectRoles = uniq([...readRoles, ...insertRoles, ...updateRoles, ...deleteRoles]);

  const roles: AclRoles = Object.freeze({
    select: selectRoles,
    insert: insertRoles,
    update: updateRoles,
    delete: deleteRoles,
    hardDelete: hardDeleteRoles,
    edit: editRoles,
    deleted: deletedRoles,
  });

  const def = {
    input: Object.freeze({
      ...input,
      ...(input.owner
        ? {
            owner: Object.freeze({
              field: input.owner.field,
              can: Object.freeze([...new Set(input.owner.can)]),
            }),
          }
        : {}),
      ...(input.allowAnomalies
        ? { allowAnomalies: Object.freeze([...new Set(input.allowAnomalies)]) }
        : {}),
    }),
    roles,
  } as unknown as AclDefinition;

  Object.defineProperty(def, ACL_BRAND, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  });

  return Object.freeze(def);
}

const makeRowRule = (
  ownerField: string | undefined,
  withOwner: boolean,
  roles: readonly string[],
): ((ctx: DataContext) => Filter) => {
  if (withOwner && ownerField) return policy.ownerOrRoles(ownerField, roles);
  if (roles.length > 0) return policy.roles(roles);
  return policy.deny();
};

const hasDeletedTimestamp = (r: Row): boolean => {
  if (r.softDelete != null) return true;
  const t = r.timestamps as Record<string, unknown> | undefined | null;
  if (!t || typeof t !== "object") return false;
  const d = t.deletedAt;
  if (typeof d === "string") return d.length > 0;
  if (d && typeof d === "object") {
    const f = (d as { field?: unknown }).field;
    return typeof f === "string" && f.length > 0;
  }
  return false;
};

/**
 * Разворачивает `acl` в `policy` и `timestamps.deletedAt.readDeleted` до вызова `expandTimestamps`.
 * Возвращает нормализованное описание ресурса и информацию для запуска стража инвариантов.
 */
export function expandAcl(rawInput: Row): {
  readonly normalized: Row;
  readonly enforceGuard: boolean;
  readonly allowAnomalies: ReadonlySet<AclRuleName>;
  readonly aclOwnerField?: string;
} {
  const skip = (rawInput as Record<symbol, unknown>)[SKIP_ACL_GUARD] === true;
  if (rawInput.acl === undefined || rawInput.acl === null) {
    const { acl: _drop, ...rest } = rawInput;
    return {
      normalized: rest,
      enforceGuard: false,
      allowAnomalies: new Set(),
    };
  }
  if (!isAclDefinition(rawInput.acl)) {
    fail("validation", undefined, ["acl: ожидается результат вызова defineAcl({ … })"]);
  }
  if (rawInput.policy !== undefined && rawInput.policy !== null) {
    fail("validation", undefined, [
      "acl и policy заданы одновременно: используйте либо acl: defineAcl(…), либо низкоуровневый policy",
    ]);
  }

  const acl = rawInput.acl;
  const inp = acl.input;
  const allowAnomalies = new Set<AclRuleName>(inp.allowAnomalies ?? []);
  const issues: string[] = [];

  const ownerField = inp.owner?.field;
  const fieldsObj = rawInput.fields as Record<string, unknown> | undefined;
  if (ownerField && (!fieldsObj || !Object.prototype.hasOwnProperty.call(fieldsObj, ownerField))) {
    issues.push(`acl.owner.field: в модели нет поля «${ownerField}»`);
  }

  const softCapable = hasDeletedTimestamp(rawInput);
  const usesSoftOnlyFeatures =
    Boolean(inp.softDelete?.length) ||
    Boolean(inp.deleted?.length) ||
    Boolean(inp.owner?.can.includes("softDelete"));

  if (!softCapable && usesSoftOnlyFeatures && !allowAnomalies.has("soft-delete-requires-deleted-at")) {
    issues.push(
      "acl: указаны softDelete или deleted, но у модели не включено мягкое удаление (timestamps.deletedAt)",
    );
  }

  let nextTimestamps = rawInput.timestamps;
  if (softCapable && rawInput.timestamps && typeof rawInput.timestamps === "object") {
    const t = rawInput.timestamps as Record<string, unknown>;
    const d = t.deletedAt;
    if (typeof d === "string" && d.length > 0) {
      nextTimestamps = {
        ...t,
        deletedAt: { field: d, readDeleted: [...acl.roles.deleted] },
      };
    } else if (d && typeof d === "object") {
      const dObj = d as { field?: unknown; readDeleted?: unknown };
      if (dObj.readDeleted !== undefined && inp.deleted !== undefined) {
        issues.push(
          "acl.deleted и timestamps.deletedAt.readDeleted заданы одновременно: укажите роли удалённых только в acl.deleted",
        );
      } else if (dObj.readDeleted === undefined && typeof dObj.field === "string" && dObj.field.length > 0) {
        nextTimestamps = {
          ...t,
          deletedAt: { ...dObj, readDeleted: [...acl.roles.deleted] },
        };
      }
    }
  }

  if (issues.length) fail("validation", undefined, issues);

  const ownerCaps = new Set<AclOwnerCapability>(inp.owner?.can ?? []);
  const ownerEdit = ownerCaps.has("edit");
  const ownerUpdate = ownerCaps.has("update") || ownerEdit;
  const ownerDelete = ownerCaps.has("softDelete") || ownerEdit;
  const ownerHardDelete = ownerEdit;
  const ownerSelect = ownerCaps.has("read") || ownerUpdate || ownerDelete;

  const baseSelect = inp.publicRead
    ? policy.publicRows()
    : makeRowRule(ownerField, ownerSelect, acl.roles.select);
  const baseUpdate = makeRowRule(ownerField, ownerUpdate, acl.roles.update);
  const baseDelete = makeRowRule(ownerField, ownerDelete, acl.roles.delete);
  const baseHardDelete = makeRowRule(ownerField, ownerHardDelete, acl.roles.hardDelete);

  const builtPolicy: Policy = {
    select: inp.extend?.select ? policy.extend(baseSelect, inp.extend.select) : baseSelect,
    insert: acl.roles.insert.length > 0 ? policy.roles(acl.roles.insert) : policy.deny(),
    update: inp.extend?.update ? policy.extend(baseUpdate, inp.extend.update) : baseUpdate,
    delete: inp.extend?.delete ? policy.extend(baseDelete, inp.extend.delete) : baseDelete,
    ...(softCapable
      ? {
          hardDelete: baseHardDelete,
          restore: baseHardDelete,
        }
      : {}),
  };

  const { acl: _drop, ...rest } = rawInput;
  return {
    normalized: {
      ...rest,
      ...(nextTimestamps !== undefined ? { timestamps: nextTimestamps } : {}),
      policy: builtPolicy,
    },
    enforceGuard: !skip,
    allowAnomalies,
    aclOwnerField: ownerField,
  };
}

/* ── Статический разбор клауз для стража инвариантов и grants() ──────────── */

export function extractPolicyClause(
  fn: ((ctx: DataContext) => unknown) | undefined,
  defaultPublic = true,
): { readonly clause: readonly string[] | null; readonly ownerField?: string } {
  if (fn === undefined) {
    return { clause: defaultPublic ? ["*"] : [] };
  }
  const meta: PolicyMeta | null = readPolicyMeta(fn);
  if (meta) {
    switch (meta.kind) {
      case "public":
        return { clause: ["*"] };
      case "deny":
        return { clause: [] };
      case "roles":
        return { clause: [...meta.roles] };
      case "ownerOrRoles":
        return { clause: ["owner", ...meta.roles], ownerField: meta.field };
      case "clause":
        return { clause: [...meta.clause], ...(meta.ownerField ? { ownerField: meta.ownerField } : {}) };
    }
  }
  // Нулеарные константные предикаты `() => true` / `() => false`, не читающие `ctx`:
  if (typeof fn === "function" && fn.length === 0) {
    try {
      const res = fn({ principal: { roles: [] } });
      if (res === true) return { clause: ["*"] };
      if (res === false) return { clause: [] };
    } catch {
      return { clause: null };
    }
  }
  return { clause: null };
}

export function extractMaskClause(mask: Grant | null | undefined, openByDefault: boolean): readonly string[] | null {
  if (mask === undefined || mask === null) return openByDefault ? ["*"] : [];
  if (typeof mask !== "function") return [...new Set(mask)];
  return extractPolicyClause(mask, openByDefault).clause;
}

const clauseCoversAtom = (clause: readonly string[], atom: string): boolean =>
  clause.includes("*") || clause.includes(atom);

const maskAllowsAtom = (maskClause: readonly string[] | null, atom: string): boolean => {
  // Неизвестная функция маски трактуется консервативно: считаем, что может пропустить.
  if (maskClause === null) return true;
  if (maskClause.includes("*")) return true;
  if (atom === "*") return false;
  return maskClause.includes(atom);
};

export interface ValidateAclOptions {
  readonly allowAnomalies?: readonly AclRuleName[];
  readonly ownerFieldHint?: string;
}

/**
 * Проверяет модель `Resource` на соблюдение аксиом ACL.
 * Вызывается автоматически внутри `defineResource` при использовании `defineAcl`,
 * а также доступна отдельно для аудита любых моделей с низкоуровневым `policy`.
 * Возвращает список нарушений (пустой массив — модель консистентна).
 */
export function collectResourceAclIssues(
  r: Resource,
  options?: ValidateAclOptions,
): string[] {
  const allowed = new Set<AclRuleName>(options?.allowAnomalies ?? []);
  const issues: string[] = [];

  const sel = extractPolicyClause(r.policy?.select, true);
  const ins = extractPolicyClause(r.policy?.insert, true);
  const upd = extractPolicyClause(r.policy?.update, true);
  const del = extractPolicyClause(r.policy?.delete, true);
  const hardDel = r.softDelete
    ? extractPolicyClause(r.policy?.hardDelete ?? r.policy?.delete, true)
    : del;

  if (sel.clause !== null) {
    if (!allowed.has("insert-implies-select") && ins.clause !== null) {
      for (const atom of ins.clause) {
        if (!clauseCoversAtom(sel.clause, atom)) {
          issues.push(
            `[insert-implies-select] ${r.key}: роль «${atom}» разрешена в insert, но отсутствует в select (insert обязан включать чтение)`,
          );
        }
      }
    }
    if (!allowed.has("update-implies-select") && upd.clause !== null) {
      for (const atom of upd.clause) {
        if (!clauseCoversAtom(sel.clause, atom)) {
          issues.push(
            `[update-implies-select] ${r.key}: «${atom}» разрешён в update, но отсутствует в select`,
          );
        }
      }
    }
    if (!allowed.has("delete-implies-select") && del.clause !== null) {
      for (const atom of del.clause) {
        if (!clauseCoversAtom(sel.clause, atom)) {
          issues.push(
            `[delete-implies-select] ${r.key}: «${atom}» разрешён в delete, но отсутствует в select`,
          );
        }
      }
    }
  }

  if (
    r.softDelete &&
    !allowed.has("hard-delete-implies-delete") &&
    hardDel.clause !== null &&
    del.clause !== null
  ) {
    for (const atom of hardDel.clause) {
      if (!clauseCoversAtom(del.clause, atom)) {
        issues.push(
          `[hard-delete-implies-delete] ${r.key}: «${atom}» разрешён в hardDelete, но отсутствует в мягком delete`,
        );
      }
    }
  }

  if (upd.clause !== null && upd.clause.length > 0) {
    const inferredOwnerField =
      options?.ownerFieldHint ??
      r.ownerField ??
      sel.ownerField ??
      upd.ownerField ??
      del.ownerField;

    const entries = Object.entries(r.fields) as [string, Field<unknown>][];
    // Пользовательские содержательные поля данных (без суррогатного PK, колонки владельца и автогенерируемых полей)
    const payloadFields = entries.filter(
      ([k, f]) =>
        k !== r.primaryKey &&
        k !== r.ownerField &&
        k !== inferredOwnerField &&
        !f.generated &&
        !f.createValue &&
        !f.fill,
    );

    const updatableFields = entries.filter(
      ([k, f]) =>
        k !== r.primaryKey &&
        k !== r.ownerField &&
        !f.generated &&
        !f.createValue &&
        !f.fill &&
        !f.immutable,
    );

    for (const atom of upd.clause) {
      const writableForAtom = updatableFields.filter(([, f]) =>
        maskAllowsAtom(extractMaskClause(f.update, true), atom),
      );

      if (!allowed.has("update-has-writable-field") && writableForAtom.length === 0) {
        issues.push(
          `[update-has-writable-field] ${r.key}: «${atom}» присутствует в policy.update, но ни одно поле модели не открыто ему на изменение`,
        );
        continue;
      }

      if (
        !allowed.has("update-without-delete-needs-protected-field") &&
        del.clause !== null &&
        !clauseCoversAtom(del.clause, atom) &&
        writableForAtom.length > 0
      ) {
        const protectedFields = payloadFields.filter(
          ([, f]) =>
            Boolean(f.immutable) ||
            !maskAllowsAtom(extractMaskClause(f.update, true), atom),
        );
        if (protectedFields.length === 0) {
          issues.push(
            `[update-without-delete-needs-protected-field] ${r.key}: «${atom}» имеет право update без delete, но у модели нет защищённых от него полей (все данные можно затереть вместо удаления)`,
          );
        }
      }
    }
  }

  return issues;
}

export function validateResourceAcl(r: Resource, options?: ValidateAclOptions): void {
  const issues = collectResourceAclIssues(r, options);
  if (issues.length) fail("validation", undefined, issues);
}
