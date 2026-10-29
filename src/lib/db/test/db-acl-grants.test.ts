/**
 * Тесты `defineAcl`, стража инвариантов ACL (`validateResourceAcl`),
 * извлечения прав `grants(resource)` и чистой проверки `checkGrants` / `forOwner`
 * (docs/plan-acl-grants-2026-10-29.md).
 */
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, describe, expect, it } from "vitest";
import {
  DbFailure,
  checkGrants,
  collectResourceAclIssues,
  conservativeLimits,
  createDb,
  defineAcl,
  defineResource,
  f,
  field,
  forOwner,
  grants,
  policy,
  s,
  validateResourceAcl,
  type DataContext,
  type Database,
  type Resource,
} from "../index";
import { pgliteAdapter } from "../adapters/pglite";
import { defineSchema } from "../sync/index";

let shared: PGlite | undefined;
afterAll(async () => {
  await shared?.close();
});

async function withDb(resources: Resource[], fn: (db: Database) => Promise<void>) {
  shared ??= new PGlite();
  await shared.exec("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  const driver = pgliteAdapter(shared);
  assert.equal((await defineSchema({ resources }).sync(driver)).status, "ok");
  await fn(createDb({ driver, limits: conservativeLimits, resources }));
}

const idField = () =>
  f.uuid({
    read: () => true,
    createValue: () => crypto.randomUUID(),
    immutable: true,
    orderable: true,
    filters: ["eq"] as const,
    db: { default: "gen_random_uuid()" },
  });

const asCtx = (id: string | undefined, roles: readonly string[] = []): DataContext => ({
  principal: { ...(id ? { id } : {}), roles: [...roles] },
});

describe("defineAcl и страж инвариантов ACL", () => {
  it("ловит update без delete, когда все пользовательские поля можно затереть", () => {
    expect(() =>
      defineResource({
        key: "t.acl.badProfile",
        table: "public.bad_profile",
        primaryKey: "id",
        fields: {
          id: idField(),
          owner_id: f.uuid({ read: () => true, create: () => true, required: true, immutable: true }),
          bio: f.text({ read: () => true, create: () => true, update: () => true, nullable: true }),
        },
        acl: defineAcl({
          owner: { field: "owner_id", can: ["update"] },
          edit: ["admin"],
        }),
        order: [["id", "asc"]],
      }),
    ).toThrowError(DbFailure);

    try {
      defineResource({
        key: "t.acl.badProfile2",
        table: "public.bad_profile2",
        primaryKey: "id",
        fields: {
          id: idField(),
          owner_id: f.uuid({ read: () => true, create: () => true, required: true, immutable: true }),
          bio: f.text({ read: () => true, create: () => true, update: () => true, nullable: true }),
        },
        acl: defineAcl({
          owner: { field: "owner_id", can: ["update"] },
          edit: ["admin"],
        }),
        order: [["id", "asc"]],
      });
    } catch (e) {
      expect(e).toBeInstanceOf(DbFailure);
      expect((e as DbFailure).details.issues?.some((msg) => msg.includes("update-without-delete-needs-protected-field"))).toBe(true);
    }
  });

  it("пропускает update без delete при наличии защищённых полей и поддерживает allowAnomalies", () => {
    const modAcl = defineAcl({
      read: ["viewer"],
      update: ["courier"],
      edit: ["admin"],
    });
    const orderModel = defineResource({
      key: "t.acl.order",
      table: "public.t_order",
      primaryKey: "id",
      fields: {
        id: idField(),
        item_code: f.text({ read: () => true, create: () => true, required: true, immutable: true }),
        status: f.text({ read: () => true, create: () => true, update: modAcl.roles.update, required: true }),
      },
      acl: modAcl,
      order: [["id", "asc"]],
    });
    expect(collectResourceAclIssues(orderModel)).toEqual([]);

    // Явное подавление конкретной аксиомы через allowAnomalies для нестандартной модели:
    const weirdModel = defineResource({
      key: "t.acl.weird",
      table: "public.t_weird",
      primaryKey: "id",
      fields: {
        id: idField(),
        note: f.text({ read: () => true, create: () => true, update: () => true, nullable: true }),
      },
      acl: defineAcl({
        update: ["helper"],
        edit: ["admin"],
        allowAnomalies: ["update-without-delete-needs-protected-field"],
      }),
      order: [["id", "asc"]],
    });
    expect(weirdModel.key).toBe("t.acl.weird");
  });

  it("ловит мёртвую роль в update без единого открытого поля и softDelete без deletedAt", () => {
    expect(() =>
      defineResource({
        key: "t.acl.deadUpdate",
        table: "public.dead_update",
        primaryKey: "id",
        fields: {
          id: idField(),
          secret: f.text({ read: () => true, create: ["admin"], update: ["admin"], required: true }),
        },
        acl: defineAcl({
          edit: ["admin", "ghost"],
        }),
        order: [["id", "asc"]],
      }),
    ).toThrowError(DbFailure);

    expect(() =>
      defineResource({
        key: "t.acl.noSoft",
        table: "public.no_soft",
        primaryKey: "id",
        fields: {
          id: idField(),
          title: f.text({ read: () => true, create: () => true, update: () => true, required: true }),
        },
        acl: defineAcl({
          softDelete: ["moderator"],
          edit: ["admin"],
        }),
        order: [["id", "asc"]],
      }),
    ).toThrowError(DbFailure);
  });

  it("validateResourceAcl проверяет и низкоуровневый policy (insert/delete без select)", () => {
    const rawBroken = defineResource({
      key: "t.acl.rawBroken",
      table: "public.raw_broken",
      primaryKey: "id",
      fields: {
        id: idField(),
        title: f.text({ read: () => true, create: () => true, update: () => true, required: true }),
      },
      policy: {
        select: policy.roles(["reader"]),
        insert: policy.roles(["writer"]),
        update: policy.deny(),
        delete: policy.roles(["deleter"]),
      },
      order: [["id", "asc"]],
    });
    const issues = collectResourceAclIssues(rawBroken);
    expect(issues.some((m) => m.includes("insert-implies-select"))).toBe(true);
    expect(issues.some((m) => m.includes("delete-implies-select"))).toBe(true);
    expect(() => validateResourceAcl(rawBroken)).toThrowError(DbFailure);
  });
});

describe("PGlite + grants() + checkGrants() + forOwner()", () => {
  const accountsAcl = defineAcl({
    owner: { field: "id", can: ["read"] },
    read: ["account.read", "admin", "server"],
    insert: ["server"],
    edit: ["admin", "server"],
    deleted: ["read_delete", "account.readDeleted", "admin", "server"],
  });

  const accounts: Resource = defineResource({
    key: "t.grants.account",
    table: "public.g_account",
    primaryKey: "id",
    fields: {
      id: idField(),
      handle: f.text({
        read: () => true,
        create: accountsAcl.roles.insert,
        update: accountsAcl.roles.edit,
        required: true,
      }),
    },
    timestamps: { createdAt: "created_at", updatedAt: "updated_at", deletedAt: "deleted_at" },
    acl: accountsAcl,
    order: [["created_at", "desc"]],
  });

  const blocksAcl = defineAcl({
    owner: { field: "account_id", can: ["read"] },
    read: ["block.read"],
    insert: ["moderator", "block.edit", "admin", "server"],
    update: ["moderator"],
    softDelete: ["moderator"],
    edit: ["block.edit", "admin", "server"],
    deleted: ["read_delete", "block.readDeleted", "admin", "server"],
  });

  const blocks: Resource = defineResource({
    key: "t.grants.block",
    table: "public.g_block",
    primaryKey: "id",
    fields: {
      id: idField(),
      account_id: field(s.uuid(), {
        read: () => true,
        create: blocksAcl.roles.insert,
        required: true,
        immutable: true,
        filters: ["eq"],
        db: { references: { resource: () => accounts, chain: true } },
      }),
      reason: field(s.text({ min: 1, max: 120 }), {
        read: () => true,
        create: blocksAcl.roles.insert,
        update: blocksAcl.roles.edit,
        required: true,
      }),
      until: f.timestamp({
        read: () => true,
        create: blocksAcl.roles.insert,
        update: blocksAcl.roles.update,
        nullable: true,
      }),
    },
    timestamps: { createdAt: "created_at", updatedAt: "updated_at", deletedAt: "deleted_at" },
    acl: blocksAcl,
    order: [["created_at", "desc"]],
  });

  it("checkGrants: одиночные клаузы, межмодельные массивы [a.select, b.insert], словарь, forOwner и чужой actor", () => {
    const gAcc = grants(accounts);
    const gBlk = grants(blocks);

    // 1. Межмодельная связка: у accounts на select есть 'account.read', у blocks на insert есть 'moderator'
    const pickSpec = [gAcc.select, gBlk.insert];

    expect(checkGrants({ id: "u1", permissions: ["moderator"] }, pickSpec)).toBe(false);
    expect(checkGrants({ id: "u1", permissions: ["account.read"] }, pickSpec)).toBe(false);
    expect(checkGrants({ id: "u1", permissions: ["account.read", "moderator"] }, pickSpec)).toBe(true);
    expect(checkGrants({ id: "u1", permissions: ["admin"] }, pickSpec)).toBe(true);

    // 2. Поля и окончательное удаление наёмника (moderator):
    const modWithReadDelete = { id: "m1", permissions: ["moderator", "read_delete"] };
    const modCan = checkGrants(modWithReadDelete, {
      select: gBlk.select,
      selectDeleted: gBlk.selectDeleted,
      insert: gBlk.insert,
      updateAny: gBlk.update,
      editReason: gBlk.fields.reason.update,
      softDelete: gBlk.delete,
      hardDelete: gBlk.hardDelete,
      restore: gBlk.restore,
      pickTarget: gBlk.refs.account_id,
    });
    expect(modCan).toEqual({
      select: true,
      selectDeleted: true,
      insert: true,
      updateAny: true,
      editReason: false,
      softDelete: true,
      hardDelete: false,
      restore: false,
      pickTarget: false,
    });

    // 3. Сквозная роль 'read_delete' сама по себе НЕ даёт читать ни живые, ни удалённые модели:
    const onlyReadDelete = { id: "u2", permissions: ["read_delete"] };
    expect(checkGrants(onlyReadDelete, gAcc.select)).toBe(false);
    expect(checkGrants(onlyReadDelete, gAcc.selectDeleted)).toBe(false);
    expect(checkGrants(onlyReadDelete, gBlk.select)).toBe(false);
    expect(checkGrants(onlyReadDelete, gBlk.selectDeleted)).toBe(false);

    // А в связке с чтением ТОЛЬКО blocks открывает удалённые в blocks, но НЕ открывает accounts:
    const blockReaderWithDeleted = { id: "u3", permissions: ["block.read", "read_delete"] };
    expect(checkGrants(blockReaderWithDeleted, gBlk.selectDeleted)).toBe(true);
    expect(checkGrants(blockReaderWithDeleted, gAcc.select)).toBe(false);
    expect(checkGrants(blockReaderWithDeleted, gAcc.selectDeleted)).toBe(false);

    // 4. forOwner: не протекает на глобальную проверку справочника в одном массиве!
    const selfActor = { id: "self-id", permissions: [] };
    // Свой бан читается, но глобальный справочник аккаунтов — нет:
    expect(checkGrants(selfActor, forOwner("self-id", gBlk.select))).toBe(true);
    expect(
      checkGrants(selfActor, [forOwner("self-id", gBlk.select), gAcc.select]),
    ).toBe(false);

    // 5. Совместимость со схемой ключа user.config (`Record<string, readonly string[]>`):
    const configKeySchema = {
      editDefault: ["admin"],
      assign: ["owner", "admin", "profile.edit"],
      editUser: ["owner", "admin"],
      deleteUser: ["admin"],
    };
    expect(checkGrants(selfActor, configKeySchema, { ownerId: "self-id" })).toEqual({
      editDefault: false,
      assign: true,
      editUser: true,
      deleteUser: false,
    });
    // Проверка за другого пользователя (actor):
    const otherUser = { id: "other-id", permissions: ["profile.edit"] };
    expect(checkGrants(otherUser, configKeySchema, { ownerId: "self-id" })).toEqual({
      editDefault: false,
      assign: true,
      editUser: false,
      deleteUser: false,
    });
  });

  it(
    "PGlite исполняет те же самые правила: read_delete не сливает живые, а модератор не стирает hard: true",
    async () => {
      await withDb([accounts, blocks], async (db) => {
        const accApi = db.resource(accounts);
        const blkApi = db.resource(blocks);

        const server = asCtx(undefined, ["server"]);
        const target = await accApi.insert(server, { handle: "victim" });
        const mod = asCtx(crypto.randomUUID(), ["moderator"]);
        const modPlusDeleted = asCtx(crypto.randomUUID(), ["moderator", "read_delete"]);
        const pureReadDelete = asCtx(crypto.randomUUID(), ["read_delete"]);
        const readerPlusDeleted = asCtx(crypto.randomUUID(), ["block.read", "read_delete"]);
        const editorPlusDeleted = asCtx(crypto.randomUUID(), ["block.edit", "read_delete"]);

        // 1. Модератор создаёт бан и снимает его через until, но не может поменять reason
        const created = await blkApi.insert(mod, {
          account_id: target.id,
          reason: "спам",
          until: null,
        });
        await blkApi.update(mod, created.id, { until: new Date().toISOString() });
        await assert.rejects(
          () => blkApi.update(mod, created.id, { reason: "подмена" }),
          (e: unknown) => e instanceof DbFailure && e.kind === "forbidden",
        );

        // 2. Голая роль 'read_delete' НЕ видит ни живые, ни удалённые записи ни в одной модели:
        assert.equal((await blkApi.select(pureReadDelete)).length, 0);
        assert.equal((await blkApi.select(pureReadDelete, { includeDeleted: true })).length, 0);
        assert.equal((await accApi.select(pureReadDelete, { includeDeleted: true })).length, 0);

        // 3. Модератор НЕ может сделать hard: true даже на живой записи, даже имея 'read_delete':
        await assert.rejects(
          () => blkApi.delete(mod, created.id, { hard: true }),
          (e: unknown) => e instanceof DbFailure && e.kind === "forbidden",
        );
        await assert.rejects(
          () => blkApi.delete(modPlusDeleted, created.id, { hard: true }),
          (e: unknown) => e instanceof DbFailure && (e.kind === "forbidden" || e.kind === "not_found"),
        );

        // 4. Мягкое удаление модератором оставляет запись в архиве; её видит block.read + read_delete:
        await blkApi.delete(mod, created.id);
        assert.equal((await blkApi.select(mod)).length, 0);
        assert.equal((await blkApi.select(readerPlusDeleted, { includeDeleted: true })).length, 1);

        // И даже на уже мягко удалённой записи модератор с read_delete НЕ может сделать hard: true или restore:
        await assert.rejects(
          () => blkApi.delete(modPlusDeleted, created.id, { hard: true }),
          (e: unknown) => e instanceof DbFailure && (e.kind === "forbidden" || e.kind === "not_found"),
        );
        await assert.rejects(
          () => blkApi.restore(modPlusDeleted, created.id),
          (e: unknown) => e instanceof DbFailure && (e.kind === "forbidden" || e.kind === "not_found"),
        );

        // 5. Связка block.edit + read_delete восстанавливает и окончательно удаляет запись, а without() продолжает работать:
        await blkApi.restore(editorPlusDeleted, created.id);
        assert.equal((await blkApi.select(mod)).length, 1);
        await blkApi.delete(editorPlusDeleted, created.id, { hard: true });
        assert.equal((await blkApi.select(editorPlusDeleted, { includeDeleted: true })).length, 0);

        const rowsWithoutSelectPolicy = await db
          .resource(blocks)
          .without(["policy.select"], (b) => b.select(pureReadDelete));
        assert.equal(rowsWithoutSelectPolicy.length, 0);
      });
    },
    30_000,
  );
});
