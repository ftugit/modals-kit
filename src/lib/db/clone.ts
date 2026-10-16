/**
 * Временный экземпляр модели без части автоматики (`without`): та же модель, заново
 * собранная из её описания, где выбранные опции заменены на `null`. Операции об этом не
 * знают — у них просто другая схема (docs/design/model-automation.md §1, §8).
 */
import { fail } from "./errors";
import { defineResource, isRecord, MODELS, own, timestampField, type ModelOrigin } from "./validation";
import { liveCapabilities } from "./validation";
import type { Resource, Row } from "./types";

/** Опции поля, которые можно выключить: права поля и автоматика значения. */
const FIELD_OPTIONS = ["read", "create", "update", "normalize", "createValue", "fill", "store", "required"] as const;
const POLICY_OPS = ["select", "insert", "update", "delete", "restore"] as const;
const HOOKS = ["beforeWrite", "afterWrite", "afterRead", "afterCommit"] as const;
/** Ключи без опции в схеме: поведение, которое снимает сам экземпляр. */
export const BEHAVIOR_KEYS = ["protect"] as const;

export function originOf(r: Resource): ModelOrigin {
  return MODELS.get(r) ?? { source: r, origin: r, off: [], raw: false };
}

const has = (o: unknown, k: string) => isRecord(o) && own(o, k) && o[k] != null;

/** Подходит ли путь модели. Ошибка — текст причины. */
function applies(source: Row, model: Resource, path: string): string | undefined {
  const parts = path.split(".");
  const [head, second, third] = parts;
  const fields = source.fields as Record<string, Row>;
  const no = (what: string) => `${path}: у модели ${model.key} нет ${what}`;
  switch (head) {
    case "protect":
      return parts.length === 1 ? undefined : `${path}: неизвестный путь`;
    case "policy":
      if (parts.length === 1) return has(source, "policy") && Object.values(source.policy as Row).some((v) => v != null) ? undefined : no("policy");
      if (parts.length === 2 && (POLICY_OPS as readonly string[]).includes(second!)) return has(source.policy, second!) ? undefined : no(`policy.${second}`);
      return `${path}: неизвестный путь — есть policy, policy.select|insert|update|delete|restore`;
    case "grants":
      if (parts.length !== 1) return `${path}: неизвестный путь`;
      return Object.values(fields).some((f) => has(f, "read") || has(f, "create") || has(f, "update")) ? undefined : no("масок полей");
    case "hooks":
      if (parts.length === 1) return has(source, "hooks") ? undefined : no("hooks");
      if (parts.length === 2 && (HOOKS as readonly string[]).includes(second!)) return has(source.hooks, second!) ? undefined : no(path);
      return `${path}: неизвестный путь`;
    case "checks":
    case "validateFinal":
      return parts.length === 1 ? (has(source, head) ? undefined : no(head)) : `${path}: неизвестный путь`;
    case "timestamps": {
      if (!["createdAt", "updatedAt", "deletedAt"].includes(second ?? "")) return `${path}: неизвестный путь — есть timestamps.createdAt|updatedAt|deletedAt`;
      if (!timestampField(model, second as "createdAt")) return no(path);
      return parts.length === 2 ? undefined : `${path}: неизвестный путь`;
    }
    case "softDelete":
      if (!has(source, "softDelete")) return no("softDelete");
      return parts.length === 1 ? undefined : `${path}: неизвестный путь`;
    case "fields": {
      if (parts.length !== 3 || !(FIELD_OPTIONS as readonly string[]).includes(third!))
        return `${path}: неизвестный путь — fields.<поле|*>.${FIELD_OPTIONS.join("|")}`;
      if (second === "*") return Object.values(fields).some((f) => has(f, third!)) ? undefined : no(`полей с ${third}`);
      if (!own(fields, second!)) return no(`поля ${second}`);
      return has(fields[second!], third!) ? undefined : no(path);
    }
    default:
      return `${path}: неизвестный путь`;
  }
}

/** Описание с `null` по путям. */
function nulled(source: Row, paths: readonly string[]): Row {
  const out: Row = { ...source, fields: { ...(source.fields as Row) } };
  const fields = out.fields as Record<string, Row>;
  const setField = (name: string, opt: string, value: unknown) => {
    fields[name] = { ...fields[name], [opt]: value };
  };
  for (const path of paths) {
    const [head, second, third] = path.split(".");
    if (head === "protect") continue;
    if (head === "policy" || head === "hooks") {
      if (!second) out[head] = null;
      else out[head] = { ...(out[head] as Row), [second]: null };
    } else if (head === "checks" || head === "validateFinal") out[head] = null;
    else if (head === "grants") for (const k of Object.keys(fields)) for (const m of ["read", "create", "update"]) setField(k, m, null);
    else if (head === "timestamps") {
      out.timestamps = { ...(out.timestamps as Row), [second!]: null };
    } else if (head === "softDelete") out.softDelete = null;
    else if (head === "fields") for (const k of second === "*" ? Object.keys(fields) : [second!]) setField(k, third!, null);
  }
  return out;
}

/** Проверить пути и собрать модель без них. Пути складываются с уже выключенным. */
export function withoutPaths(model: Resource, paths: readonly string[]): Resource {
  if (!Array.isArray(paths) || !paths.length || paths.some((p) => typeof p !== "string"))
    fail("validation", undefined, ["without: непустой список путей схемы (['timestamps.updatedAt', 'policy', …])"]);
  const from = originOf(model);
  if (from.raw) fail("validation", undefined, ["without: у сырого экземпляра (raw) выключено всё"]);
  const issues = paths.map((p) => applies(from.source as unknown as Row, from.origin, p)).filter((x): x is string => !!x);
  if (issues.length) fail("validation", undefined, issues);
  const off = [...new Set([...from.off, ...paths])];
  const clone = defineResource(nulled(from.source as unknown as Row, off.filter((p) => !(BEHAVIOR_KEYS as readonly string[]).includes(p))) as never) as Resource;
  MODELS.set(clone, { source: from.source, origin: from.origin, off, raw: false });
  return clone;
}

/** Пути из `off`, которые подходят этой модели (для звеньев цепочки — шаг 7). */
export function applicable(model: Resource, paths: readonly string[]): string[] {
  const from = originOf(model);
  return paths.filter((p) => !applies(from.source as unknown as Row, from.origin, p));
}

/** Поведение модели: метки времени, что умеет опрос, что выключено. */
export function behavior(model: Resource) {
  const from = originOf(model);
  const names = (model.timestamps ?? {}) as Record<string, string>;
  return Object.freeze({
    timestamps: Object.freeze({ ...names }),
    live: liveCapabilities(model),
    off: Object.freeze([...from.off]),
    raw: from.raw,
  });
}
