/**
 * Тестовый фикстурный ресурс (author/blog) — перенос `server/modules/probe/resources.ts`
 * из SolidHono f8079b1, но объявленный на примитивах `@standard-schema` из
 * `src/db/schema.ts` (без zod). POLICY/GRANTS/FILTERS — слово в слово,
 * чтобы перенесённые проверки источника проверяли то же самое.
 */
import { defineResource, f, field, policy, s } from"../../index";
import type { DataContext, Operator } from"../../index";
import { DbFailure } from"../../index";

const everyone = () => true;
const writers = ["author", "editor"];
const eq: readonly Operator[] = ["eq", "ne", "in", "notIn", "isNull", "isNotNull"];
const ordered: readonly Operator[] = [...eq, "lt", "lte", "gt", "gte"];
function actor(ctx: DataContext) {
  if (!ctx.principal.id) throw new DbFailure("forbidden");
  return ctx.principal.id;
}
export const authors = defineResource({
  key: "probe.author.v1",
  table: "db_probe.author",
  primaryKey: "id",
  ownerField: "id",
  fields: {
    id: f.uuid({ read: everyone, createValue: actor, immutable: true, filters: eq, orderable: true }),
    name: field(s.text({ min: 1, max: 100 }), {
      read: everyone,
      create: writers,
      update: writers,
      required: true,
      normalize: (v) => (typeof v === "string" ? v.trim() : v),
      filters: [...eq, "contains", "startsWith"],
      orderable: true,
    }),
    private_note: field(s.text({ max: 1000 }), {
      read: ["editor"],
      create: ["editor"],
      update: ["editor"],
    }),
  },
  policy: {
    select: policy.publicRows(),
    insert: policy.roles(writers),
    update: policy.ownerOrRoles("id", ["editor"]),
    delete: policy.ownerOrRoles("id", ["editor"]),
  },
  constraints: { author_pkey: { sqlstate: "23505", fields: ["id"], expose: ["editor"] } },
  order: [["name", "asc"]],
});
export const blogs = defineResource({
  key: "probe.blog.v1",
  table: "db_probe.blog",
  primaryKey: "id",
  ownerField: "owner_id",
  fields: {
    id: f.uuid({ read: everyone, createValue: () => crypto.randomUUID(), immutable: true, filters: eq, orderable: true }),
    owner_id: f.uuid({ read: everyone, createValue: actor, immutable: true, filters: eq, orderable: true }),
    title: field(s.text({ min: 2, max: 200 }), {
      read: everyone,
      create: writers,
      update: writers,
      required: true,
      normalize: (v) => (typeof v === "string" ? v.trim() : v),
      filters: [...eq, "contains", "startsWith"],
      orderable: true,
    }),
    body: field(s.text({ max: 20_000 }), {
      read: everyone,
      create: writers,
      update: writers,
      filters: ["eq", "contains"],
    }),
    private_note: field(s.text({ max: 1000 }), {
      read: ["editor"],
      create: ["editor"],
      update: ["editor"],
    }),
    score: f.decimal({ read: everyone, create: writers, update: writers, filters: ordered, orderable: true }),
    sequence: f.bigint({ read: everyone, create: writers, update: writers, filters: ordered, orderable: true }),
    active: f.boolean({ read: everyone, create: writers, update: writers, filters: eq }),
    tags: field(s.array(s.text({ max: 100 }), { max: 20 }), {
      read: everyone,
      create: writers,
      update: writers,
    }),
    meta: f.json({ read: everyone, create: writers, update: writers }),
    published_at: f.timestamp({
      read: everyone,
      create: writers,
      update: writers,
      nullable: true,
      filters: ordered,
      orderable: true,
    }),
    created_at: f.timestamp({ read: everyone, generated: true, filters: ordered, orderable: true }),
    deleted_at: f.timestamp({
      read: ["editor"],
      generated: true,
      nullable: true,
      filters: ordered,
      orderable: true,
    }),
  },
  policy: {
    select: policy.publicRows(),
    insert: policy.roles(writers),
    update: policy.ownerOrRoles("owner_id", ["editor"]),
    delete: policy.ownerOrRoles("owner_id", ["editor"]),
  },
  order: [["created_at", "desc"]],
  softDelete: {
    field: "deleted_at",
    value: () => new Date().toISOString(),
    readDeleted: ["editor"],
  },
  relations: { author: { resource: authors, localField: "owner_id", foreignField: "id" } },
});
