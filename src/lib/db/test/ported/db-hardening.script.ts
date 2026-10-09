/** Регрессии исправлений аудита: PASS означает безопасное ожидаемое поведение. Только local RAM/mocks. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const F = await import("../fixture.ts");
const checks = [];
async function test(name, fn) {
  await fn();
  checks.push(name);
  console.log('PASS', name);
}
const pg = new PGlite();
await pg.exec(await readFile(new URL("../../migrations/001-db-probe.sql", import.meta.url), 'utf8'));
const db = F.createDb({ driver: F.pgliteAdapter(pg), limits: F.conservativeLimits });
const a = { principal: { id: crypto.randomUUID(), roles: ['author'] } },
  b = { principal: { id: crypto.randomUUID(), roles: ['author'] } };
const api = F.createProbeApi(db);
await api.author.insert(a, { name: 'hardening' });
const row = await api.blog.insert(a, { title: 'original' });
try {
  await test('A01 invalid row policies fail closed; optional client filter still works', async () => {
    for (const invalid of [undefined, null, Promise.resolve(false)]) {
      const r = db.resource(
        F.defineResource({
          ...F.blogs,
          policy: {
            ...F.blogs.policy,
            select: () => invalid,
            update: () => invalid,
            delete: () => invalid,
          },
        }),
      );
      await assert.rejects(() => r.select(b));
      await assert.rejects(() => r.update(b, row.id, { title: 'forbidden' }));
      await assert.rejects(() => r.delete(b, row.id));
    }
    assert.equal((await api.blog.get(a, row.id)).title, 'original');
    assert.ok((await api.blog.select(a)).length);
    const child = F.defineResource({
      ...F.authors,
      policy: { ...F.authors.policy, select: () => null },
    });
    const included = db.resource(
      F.defineResource({
        ...F.blogs,
        relations: { author: { ...F.blogs.relations.author, resource: child } },
      }),
    );
    await assert.rejects(() => included.select(a, { include: ['author'] }));
    for (const invalid of [
      'yes',
      1,
      {},
      Promise.resolve(true),
      Promise.reject(Error('invalid async policy')),
    ]) {
      const r = db.resource(
        F.defineResource({ ...F.blogs, policy: { ...F.blogs.policy, insert: () => invalid } }),
      );
      await assert.rejects(() => r.insert(a, { title: 'must not insert' }));
    }
    const r = db.resource(
      F.defineResource({
        ...F.blogs,
        fields: {
          ...F.blogs.fields,
          title: { ...F.blogs.fields.title, update: () => Promise.resolve(true) },
        },
      }),
    );
    await assert.rejects(() => r.update(a, row.id, { title: 'bad async grant' }));
  });
  await test('A02 failed operation savepoint rolls back writes and notifications; outer work commits', async () => {
    let notices = 0;
    const r = F.defineResource({
      ...F.blogs,
      hooks: {
        afterWrite: async ({ db }) => {
          await db.afterCommit(() => {
            notices++;
          });
          throw Error('hook failure');
        },
      },
    });
    await db.transaction(async (tx) => {
      await assert.rejects(() => tx.resource(r).update(a, row.id, { title: 'must rollback' }));
      assert.equal((await tx.resource(F.blogs).get(a, row.id)).title, 'original');
      await tx.resource(F.blogs).update(a, row.id, { title: 'outer committed' });
    });
    assert.equal(notices, 0);
    assert.equal((await api.blog.get(a, row.id)).title, 'outer committed');
    const beforeHook = F.defineResource({
      ...F.blogs,
      hooks: {
        beforeWrite: async ({ db }) => {
          await db.query({
            text: 'UPDATE db_probe.blog SET title=$1 WHERE id=$2',
            values: ['side effect', row.id],
          });
          throw Error('before failure');
        },
      },
    });
    await db.transaction(async (tx) => {
      await assert.rejects(() => tx.resource(beforeHook).update(a, row.id, { title: 'bad' }));
    });
    assert.equal((await api.blog.get(a, row.id)).title, 'outer committed');
  });
  await test('A14 reject NaN, hidden toJSON/toPostgres and accessors before fingerprint; valid change works', async () => {
    for (const change of [
      (draft) => {
        draft.tags[0] = NaN;
      },
      (draft) => {
        delete draft.tags[0];
      },
      (draft) => {
        draft.tags.length = 1_000_000;
      },
      (draft) => {
        Object.defineProperty(draft.tags, 'toJSON', { value: () => [null] });
      },
      (draft) => {
        Object.defineProperty(draft.tags, 'toPostgres', { value: () => '{evil}' });
      },
      (draft) => {
        Object.defineProperty(draft, 'tags', {
          enumerable: true,
          get() {
            throw Error('getter must not execute');
          },
        });
      },
    ]) {
      const r = F.defineResource({
        ...F.blogs,
        fields: {
          ...F.blogs.fields,
          tags: F.field(F.z.array(F.z.string().max(1).nullable()), {
            read: () => true,
            create: ['author'],
          }),
        },
        hooks: { beforeWrite: ({ draft }) => change(draft) },
      });
      await assert.rejects(
        () => db.resource(r).insert(a, { title: 'invalid hook output', tags: [null] }),
        (e) => e.kind === 'validation',
      );
    }
    const valid = F.defineResource({
      ...F.blogs,
      hooks: {
        beforeWrite: ({ draft }) => {
          draft.tags = ['x'];
        },
      },
    });
    assert.deepEqual((await db.resource(valid).insert(a, { title: 'valid hook', tags: [] })).tags, [
      'x',
    ]);
  });
  await test('A08 complete own positive integer limits required', async () => {
    for (const limits of [
      undefined,
      {},
      { pageSize: 20 },
      { ...F.conservativeLimits, maxPageSize: undefined },
      { ...F.conservativeLimits, filterNodes: NaN },
      Object.create(F.conservativeLimits),
      { ...F.conservativeLimits, extra: 1 },
    ])
      assert.throws(() => F.createDb({ driver: db.driver, limits }), /Invalid/);
    let accessed = false;
    const getters = {
      ...F.conservativeLimits,
      get pageSize() {
        accessed = true;
        return 20;
      },
    };
    assert.throws(() => F.createDb({ driver: db.driver, limits: getters }), /Invalid/);
    assert.equal(accessed, false);
    assert.ok(F.createDb({ driver: db.driver, limits: F.conservativeLimits }));
  });
  await test('A11 control failures cannot be caught into a successful commit', async () => {
    for (const fault of [
      'BEGIN',
      'SAVEPOINT',
      'RELEASE',
      'ROLLBACK TO',
      'COMMIT_TAG',
      'ROLLBACK',
    ]) {
      const sql = [];
      let notices = 0,
        released,
        once = false;
      const connection = {
        async query(text) {
          sql.push(text);
          if (text === 'BROKEN')
            throw Object.assign(Error('business SQL failure'), { code: '23514' });
          if (
            (fault === 'BEGIN' && text === 'BEGIN') ||
            (!once && fault === 'SAVEPOINT' && text.startsWith('SAVEPOINT ')) ||
            (!once && fault === 'RELEASE' && text.startsWith('RELEASE ')) ||
            (fault === 'ROLLBACK TO' && text.startsWith('ROLLBACK TO ')) ||
            (fault === 'ROLLBACK' && text === 'ROLLBACK')
          ) {
            once = true;
            throw Object.assign(Error('injected control failure'), { code: '57014' });
          }
          return {
            rows: [],
            rowCount: 0,
            command: text === 'COMMIT' && fault === 'COMMIT_TAG' ? 'ROLLBACK' : text.split(' ')[0],
          };
        },
        release(value) {
          released = value;
        },
      };
      const fake = F.createDb({
        driver: F.pgAdapter({ connect: async () => connection, query: connection.query }),
        limits: F.conservativeLimits,
      });
      await assert.rejects(() =>
        fake.transaction(async (tx) => {
          await tx.afterCommit(() => {
            notices++;
          });
          if (fault === 'ROLLBACK') {
            await tx.query({ text: 'BROKEN' });
            return;
          }
          if (fault === 'COMMIT_TAG') return;
          try {
            await tx.transaction(async (child) => {
              if (fault === 'ROLLBACK TO') await child.query({ text: 'BROKEN' });
            });
          } catch {}
        }),
      );
      assert.equal(notices, 0);
      if (fault !== 'COMMIT_TAG') assert.ok(!sql.includes('COMMIT'), fault);
      assert.ok(sql.includes('ROLLBACK'), fault);
      if (['COMMIT_TAG', 'ROLLBACK'].includes(fault)) assert.equal(released, true);
    }
  });
} finally {
  await pg.close();
}
if (process.argv[2])
  await writeFile(
    process.argv[2],
    JSON.stringify(
      { checks, meaning: 'Safe-behavior regression tests', network: false, nativeTcp: false },
      null,
      2,
    ) + '\n',
  );
console.log('Hardening groups:', checks.length);
