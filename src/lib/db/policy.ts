import type { DataContext, Filter } from "./types";
export const policy = {
  publicRows:
    () =>
    (_ctx: DataContext): Filter =>
      true,
  roles: (roles: readonly string[]) => (ctx: DataContext) =>
    roles.some((r) => ctx.principal.roles.includes(r)),
  ownerOrRoles:
    (field: string, roles: readonly string[]) =>
    (ctx: DataContext): Filter =>
      roles.some((r) => ctx.principal.roles.includes(r))
        ? true
        : ctx.principal.id
          ? { field, op: "eq", value: ctx.principal.id }
          : false,
  deny: () => (_ctx: DataContext) => false,
};
