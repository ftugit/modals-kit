import type { DataContext, Filter } from "./types";

export const POLICY_META: unique symbol = Symbol.for("modals-kit.db.policyMeta");

export type PolicyMeta =
  | { readonly kind: "public" }
  | { readonly kind: "deny" }
  | { readonly kind: "roles"; readonly roles: readonly string[] }
  | { readonly kind: "ownerOrRoles"; readonly field: string; readonly roles: readonly string[] }
  | { readonly kind: "clause"; readonly clause: readonly string[]; readonly ownerField?: string };

export function tagPolicy<F extends (...args: never[]) => unknown>(fn: F, meta: PolicyMeta): F {
  Object.defineProperty(fn, POLICY_META, {
    value: Object.freeze(meta),
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return fn;
}

export function readPolicyMeta(fn: unknown): PolicyMeta | null {
  if (typeof fn !== "function") return null;
  const meta = (fn as unknown as Record<symbol, PolicyMeta | undefined>)[POLICY_META];
  return meta ?? null;
}

const uniqRoles = (roles: readonly string[]): readonly string[] =>
  Object.freeze([...new Set(roles)]);

export const policy = {
  publicRows: () =>
    tagPolicy((_ctx: DataContext): Filter => true, { kind: "public" }),

  roles: (roles: readonly string[]) => {
    const list = uniqRoles(roles);
    return tagPolicy(
      (ctx: DataContext) => list.some((r) => ctx.principal.roles.includes(r)),
      { kind: "roles", roles: list },
    );
  },

  ownerOrRoles: (field: string, roles: readonly string[]) => {
    const list = uniqRoles(roles);
    return tagPolicy(
      (ctx: DataContext): Filter =>
        list.some((r) => ctx.principal.roles.includes(r))
          ? true
          : ctx.principal.id
            ? { field, op: "eq", value: ctx.principal.id }
            : false,
      { kind: "ownerOrRoles", field, roles: list },
    );
  },

  deny: () =>
    tagPolicy((_ctx: DataContext) => false, { kind: "deny" }),

  /**
   * Расширяет базовое правило дополнительным SQL-условием (например `or` с публичной
   * видимостью), сохраняя статическую метку базовых прав для `grants(resource)` и стража ACL.
   */
  extend: <R extends Filter | boolean>(
    base: (ctx: DataContext) => R,
    combine: (baseResult: R, ctx: DataContext) => Filter,
  ): ((ctx: DataContext) => Filter) => {
    const wrapped = (ctx: DataContext): Filter => combine(base(ctx), ctx);
    const meta = readPolicyMeta(base);
    return meta ? tagPolicy(wrapped, meta) : wrapped;
  },

  /**
   * Прикрепляет явный список ролей (включая `'*'` или `'owner'`) к произвольной
   * функции правила `(ctx) => Filter | boolean`.
   */
  withGrants: <F extends (ctx: DataContext) => Filter | boolean>(
    clause: readonly string[],
    fn: F,
    ownerField?: string,
  ): F =>
    tagPolicy(fn, {
      kind: "clause",
      clause: uniqRoles(clause),
      ...(ownerField ? { ownerField } : {}),
    }),
};
