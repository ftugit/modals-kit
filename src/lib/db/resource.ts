import { policyBoolean } from './validation';
import { DbFailure, fail, normalizeFailure } from './errors';
import { context, draftInput, freeze, grants, inputRecord, own } from './validation';
import { revalidateDraft, validateField } from './validation';
import {
  Sql,
  col,
  expr,
  filterSQL,
  ident,
  keyset,
  orderBy,
  orderSQL,
  projection,
  readable,
  table,
} from './query/sql';
import type {
  CursorInput,
  DataContext,
  Database,
  Fields,
  Filter,
  HookContext,
  Relations,
  ResourceRow,
  ListInput,
  Operation,
  Resource,
  ResourceApi,
  Row,
} from './types';
export function resourceApi<F extends Fields, R extends Relations = {}>(
  db: Database,
  r: Resource<F, R>,
): ResourceApi<F, R> {
  type Out = ResourceRow<F, R>;
  /**
   * Отмена: Statement.signal берётся из контекста запроса. Драйвер решает, что
   * с ней делать (pg — обрывает соединение, PGlite — игнорирует, см. adapters).
   * Без signal поведение идентично источнику.
   */
  const withSignal = <T extends { text: string; values?: readonly unknown[] }>(
    statement: T,
    ctx: DataContext,
  ): T => (ctx.signal ? { ...statement, signal: ctx.signal } : statement);
  const output = (row: Row, keys: readonly string[]): Out =>
    Object.fromEntries(keys.filter((k) => own(row, k)).map((k) => [k, row[k]])) as Out;
  function listInput(input: ListInput): ListInput {
    inputRecord(input, db.limits.inputKeys);
    if (
      Object.keys(input).some(
        (k) =>
          ![
            'fields',
            'filter',
            'order',
            'page',
            'limit',
            'includeDeleted',
            'include',
            'after',
          ].includes(k),
      )
    )
      fail('validation');
    if (input.includeDeleted !== undefined && typeof input.includeDeleted !== 'boolean')
      fail('validation');
    return input;
  }
  async function where(
    ctx: DataContext,
    op: Exclude<Operation, 'insert'>,
    s: Sql,
    filter?: Filter,
    includeDeleted = false,
    policyOverride?: { value: Filter },
  ): Promise<string> {
    const policy = await filterSQL(
      r,
      ctx,
      policyOverride ? policyOverride.value : r.policy[op](ctx),
      s,
      db.limits,
      true,
    );
    const client = await filterSQL(r, ctx, filter, s, db.limits);
    let deleted = 'TRUE';
    if (r.softDelete) {
      if (includeDeleted && !grants(r.softDelete.readDeleted, ctx)) fail('forbidden');
      if (!includeDeleted) deleted = col(r, r.softDelete.field) + ' IS NULL';
    }
    return `(${policy}) AND (${client}) AND (${deleted})`;
  }
  async function idWhere(ctx: DataContext, op: 'update' | 'delete', s: Sql, id: unknown) {
    const v = await validateField(r.fields[r.primaryKey], id, r.primaryKey);
    return `(${await where(ctx, op, s)}) AND ${col(r, r.primaryKey)} = ${s.param(v)}`;
  }
  async function includes(ctx: DataContext, names: readonly string[] | undefined, s: Sql) {
    if (names === undefined) return { joins: '', select: '', keys: [] as string[] };
    if (!Array.isArray(names) || names.length > 8 || new Set(names).size !== names.length)
      fail('validation');
    const joins: string[] = [],
      select: string[] = [],
      keys: string[] = [];
    for (const name of names) {
      if (
        typeof name !== 'string' ||
        !r.relations ||
        !own(r.relations, name) ||
        own(r.fields, name)
      )
        fail('forbidden');
      const rel = r.relations[name],
        target = rel.resource;
      if (
        target.table === r.table ||
        rel.foreignField !== target.primaryKey ||
        !own(r.fields, rel.localField) ||
        !grants(r.fields[rel.localField].read, ctx)
      )
        fail('unsupported');
      const fields = readable(target, ctx),
        alias = ident('_db_include_' + keys.length);
      const policy = await filterSQL(target, ctx, target.policy.select(ctx), s, db.limits, true);
      const deleted = target.softDelete
        ? ' AND ' + col(target, target.softDelete.field) + ' IS NULL'
        : '';
      const object =
        'jsonb_build_object(' +
        fields.map((k) => s.param(k) + '::text, ' + expr(target, k)).join(', ') +
        ')';
      joins.push(
        ` LEFT JOIN LATERAL (SELECT ${object} AS payload FROM ${table(target)} WHERE ${col(target, rel.foreignField)} = ${col(r, rel.localField)} AND (${policy})${deleted} LIMIT 1) ${alias} ON TRUE`,
      );
      select.push(`${alias}.payload AS ${ident(name)}`);
      keys.push(name);
    }
    return {
      joins: joins.join(''),
      select: select.length ? ', ' + select.join(', ') : '',
      keys,
    };
  }
  async function read(ctx0: DataContext, input0: ListInput | CursorInput = {}, cursor = false) {
    const ctx = context(ctx0),
      input = listInput(input0),
      s = new Sql();
    const keys = readable(r, ctx, input.fields),
      order = orderBy(r, ctx, input.order);
    const limit = input.limit ?? db.limits.pageSize,
      page = input.page ?? 1;
    if (
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > db.limits.maxPageSize ||
      !Number.isSafeInteger(page) ||
      page < 1 ||
      page > db.limits.maxPage ||
      (cursor && own(input, 'page')) ||
      (!cursor && own(input, 'after'))
    )
      fail('validation');
    const policy = r.policy.select(ctx);
    let predicate = await where(ctx, 'select', s, input.filter, input.includeDeleted, {
      value: policy,
    });
    const scope = {
      resource: r.key,
      principal: ctx.principal,
      policy,
      fields: keys,
      filter: input.filter ?? true,
      order,
      include: input.include ?? [],
      deleted: input.includeDeleted ?? false,
    };
    if (cursor && !db.cursorCodec) fail('unsupported');
    const after = (input as CursorInput).after;
    if (cursor && after !== undefined) {
      const values = await db.cursorCodec!.decode(after, scope);
      if (values.length !== order.length) fail('cursor');
      for (let i = 0; i < values.length; i++)
        try {
          await validateField(r.fields[order[i][0]], values[i], order[i][0], false);
        } catch {
          fail('cursor');
        }
      predicate += ' AND ' + keyset(r, order, values, s);
    }
    const inc = await includes(ctx, input.include, s);
    const selected = [...new Set([...keys, ...(cursor ? order.map(([k]) => k) : [])])];
    const statement = withSignal(
      s.statement(
        `SELECT ${projection(r, selected)}${inc.select} FROM ${table(r)}${inc.joins} WHERE ${predicate} ORDER BY ${orderSQL(r, order)} LIMIT ${s.param(limit + (cursor ? 1 : 0))}` +
          (!cursor ? ' OFFSET ' + s.param((page - 1) * limit) : ''),
      ),
      ctx,
    );
    const rows = (await db.query(statement)).rows;
    let nextCursor: string | null = null;
    if (cursor && rows.length > limit) {
      rows.pop();
      nextCursor = await db.cursorCodec!.encode(
        scope,
        order.map(([k]) => rows[rows.length - 1][k]),
      );
    }
    const items = rows.map((row) => output(row, [...keys, ...inc.keys]));
    await r.hooks?.afterRead?.({
      ctx,
      rows: freeze(items.map((x) => ({ ...x }))),
    });
    return { items, nextCursor };
  }
  async function write(
    dbx: Database,
    ctx: DataContext,
    op: 'insert' | 'update' | 'delete',
    id: unknown,
    input: unknown,
  ): Promise<Out> {
    const keys = readable(r, ctx),
      s = new Sql();
    if (op === 'insert' && !policyBoolean(r.policy.insert(ctx))) fail('forbidden');
    let draft: Row | undefined;
    if (op !== 'delete') draft = await draftInput(r, ctx, input, op, db.limits.inputKeys);
    let before: Row | undefined;
    if (op !== 'insert' && (r.hooks?.beforeWrite || r.hooks?.afterWrite || r.validateFinal)) {
      const pre = new Sql(),
        predicate = await idWhere(ctx, op, pre, id);
      before = (
        await dbx.query(
          withSignal(
            pre.statement(
              `SELECT ${projection(r, Object.keys(r.fields))} FROM ${table(r)} WHERE ${predicate} FOR UPDATE`,
            ),
            ctx,
          ),
        )
      ).rows[0];
      if (!before) fail('not_found');
    }
    const protectedValues =
      op === 'insert'
        ? Object.fromEntries(
            Object.keys(r.fields)
              .filter((k) => r.fields[k].createValue)
              .map((k) => [k, JSON.parse(JSON.stringify(draft![k]))]),
          )
        : {};
    const validatedSnapshot = Object.fromEntries(
      Object.entries(draft ?? {}).map(([k, v]) => [k, JSON.stringify(v)]),
    );
    const event: HookContext = {
      ctx,
      operation: op,
      db: dbx,
      before: before ? freeze({ ...before }) : undefined,
      draft,
    };
    await r.hooks?.beforeWrite?.(event);
    if (draft) {
      await revalidateDraft(
        r,
        ctx,
        draft,
        op as 'insert' | 'update',
        protectedValues,
        validatedSnapshot,
      );
    }
    let sql: string;
    if (op === 'insert') {
      const entries = Object.entries(draft!);
      sql = entries.length
        ? `INSERT INTO ${table(r)} (${entries.map(([k]) => ident(r.fields[k].column ?? k)).join(',')}) VALUES (${entries.map(([k, v]) => s.fieldParam(r.fields[k], v)).join(',')})`
        : `INSERT INTO ${table(r)} DEFAULT VALUES`;
    } else {
      const predicate = await idWhere(ctx, op, s, id);
      if (op === 'delete' && !r.softDelete) sql = `DELETE FROM ${table(r)} WHERE ${predicate}`;
      else {
        const patch =
          op === 'delete'
            ? {
                [r.softDelete!.field]: await validateField(
                  r.fields[r.softDelete!.field],
                  r.softDelete!.value(ctx),
                  r.softDelete!.field,
                ),
              }
            : draft!;
        sql = `UPDATE ${table(r)} SET ${Object.entries(patch)
          .map(([k, v]) => ident(r.fields[k].column ?? k) + ' = ' + s.fieldParam(r.fields[k], v))
          .join(',')} WHERE ${predicate}`;
      }
    }
    let row: Row | undefined;
    try {
      row = (
        await dbx.query(
          withSignal(
            s.statement(
              sql +
                ' RETURNING ' +
                projection(r, r.validateFinal && op !== 'delete' ? Object.keys(r.fields) : keys),
            ),
            ctx,
          ),
        )
      ).rows[0];
    } catch (error) {
      const e = normalizeFailure(error),
        name = e.details.constraint;
      const registered =
        name && r.constraints && own(r.constraints, name) ? r.constraints[name] : undefined;
      if (
        registered &&
        e.details.sqlstate === registered.sqlstate &&
        grants(registered.expose, ctx) &&
        registered.fields.every((k) => own(r.fields, k) && grants(r.fields[k].read, ctx))
      ) {
        e.details.publicFields = Object.freeze([...registered.fields]);
      }
      throw e;
    }
    if (!row) fail('not_found');
    if (op !== 'delete' && r.validateFinal) {
      const checked = await r.validateFinal['~standard'].validate(row);
      if (checked.issues) fail('validation');
    }
    const result = output(row, keys),
      after: HookContext = {
        ...event,
        draft: undefined,
        row: freeze({ ...result }),
      };
    await r.hooks?.afterWrite?.(after);
    if (r.hooks?.afterCommit) {
      const { db: _db, draft: _draft, ...notice } = after;
      await dbx.afterCommit(() => r.hooks!.afterCommit!(notice));
    }
    return result;
  }
  async function estimate(
    ctx0: DataContext,
    input: { filter?: Filter; includeDeleted?: boolean } = {},
  ) {
    const ctx = context(ctx0);
    // Без фильтра: статистика планировщика. Только для реальных таблиц — у вьюхи
    // reltuples = 0, и это было бы «0 строк» вместо правдоподобной оценки.
    if (!input.filter) {
      const parts = r.table.split('.');
      const name = parts[parts.length - 1]!;
      const schema = parts.length > 1 ? parts[0]! : 'public';
      const s = new Sql();
      const res = await db.query(
        withSignal(
          s.statement(
            `SELECT GREATEST(0, c.reltuples)::bigint AS n FROM pg_catalog.pg_class c
              JOIN pg_catalog.pg_namespace ns ON ns.oid = c.relnamespace
             WHERE ns.nspname = ${s.param(schema)} AND c.relname = ${s.param(name)}
               AND c.relkind IN ('r', 'p', 'm')`,
          ),
          ctx,
        ),
      );
      const raw = res.rows[0]?.n;
      const n = raw === undefined || raw === null ? -1 : Number(raw);
      if (n >= 0) return { rows: n, exact: false, method: 'reltuples' as const };
    }
    const s2 = new Sql();
    const predicate = await where(ctx, 'select', s2, input.filter, input.includeDeleted ?? false);
    if (!input.filter) {
      const c = await db.query(
        withSignal(s2.statement(`SELECT count(*)::bigint AS n FROM ${table(r)} WHERE ${predicate}`), ctx),
      );
      return { rows: Number(c.rows[0]!.n), exact: true, method: 'count' as const };
    }
    try {
      const e = await db.query(
        withSignal(
          s2.statement(`EXPLAIN (FORMAT JSON) SELECT 1 FROM ${table(r)} WHERE ${predicate}`),
          ctx,
        ),
      );
      const cell = Object.values(e.rows[0] ?? {})[0];
      const plan = typeof cell === 'string' ? JSON.parse(cell) : cell;
      const first = Array.isArray(plan) ? plan[0] : plan;
      const rows = Number((first as { Plan?: { 'Plan Rows'?: number } })?.Plan?.['Plan Rows']);
      if (Number.isFinite(rows) && rows >= 0)
        return { rows: Math.round(rows), exact: false, method: 'explain' as const };
    } catch {
      // Транспорт без EXPLAIN или старый pg: считаем точно, а не возвращаем мусор.
    }
    const c = await db.query(
      withSignal(s2.statement(`SELECT count(*)::bigint AS n FROM ${table(r)} WHERE ${predicate}`), ctx),
    );
    return { rows: Number(c.rows[0]!.n), exact: true, method: 'count' as const };
  }
  async function insertMany(
    ctx0: DataContext,
    rows: readonly unknown[],
    opts: { onConflictIgnore?: boolean; chunkSize?: number; atomic?: boolean } = {},
  ): Promise<Out[]> {
    const ctx = context(ctx0);
    if (!Array.isArray(rows) || rows.length < 1 || rows.length > 5000)
      fail('validation', undefined, ['insertMany: массив от 1 до 5000 строк']);
    if (r.hooks?.beforeWrite || r.hooks?.afterWrite || r.validateFinal)
      fail('unsupported', undefined, [
        'insertMany недоступен с beforeWrite/afterWrite/validateFinal: им нужен построчный контроль результата',
      ]);
    if (!policyBoolean(r.policy.insert(ctx))) fail('forbidden');
    const drafts: Row[] = [];
    for (const row of rows) drafts.push(await draftInput(r, ctx, row, 'insert', db.limits.inputKeys));
    const keys = Object.keys(drafts[0]!);
    for (const d of drafts)
      if (Object.keys(d).length !== keys.length || !keys.every((k) => own(d, k)))
        fail('validation', undefined, [
          'insertMany: у всех строк обязан быть одинаковый набор полей — иначе часть строк получает DEFAULT, и RETURNING вводит в заблуждение',
        ]);
    const cols = Math.max(1, keys.length);
    const chunk = Math.max(1, Math.min(opts.chunkSize ?? 100, 500, Math.floor(30000 / (cols + 1))));
    const out: Out[] = [];
    const run = async (dbx: Database, items: Row[]) => {
      const s = new Sql();
      const valueTuples = items
        .map((d) => '(' + keys.map((k) => s.fieldParam(r.fields[k]!, d[k])).join(',') + ')')
        .join(',');
      const sql =
        `INSERT INTO ${table(r)} (${keys.map((k) => ident(r.fields[k]!.column ?? k)).join(',')}) VALUES ${valueTuples}` +
        (opts.onConflictIgnore ? ' ON CONFLICT DO NOTHING' : '') +
        ' RETURNING ' +
        projection(r, keys);
      const res = await dbx.query(withSignal(s.statement(sql), ctx));
      // Короткий RETURNING без ON CONFLICT DO NOTHING означает, что часть строк не
      // вошла, а ошибка потерялась (триггер,Rules, strange driver) → кричим, а не
      // возвращаем «успех» с недобором.
      if (!opts.onConflictIgnore && res.rows.length !== items.length)
        fail('database', undefined, [
          `insertMany: вставлено ${res.rows.length} из ${items.length} — RETURNING не совпал, а ON CONFLICT DO NOTHING не запрашивался`,
        ]);
      for (const row of res.rows) out.push(output(row, keys) as Out);
    };
    if (drafts.length <= chunk) await run(db, drafts);
    else if (db.driver.capabilities.transactions)
      // Больше одного round-trip → атомарно либо ничего: без транзакции половина
      // пачки могла бы записаться, и повтор импорта удвоил бы данные.
      await db.transaction(async (tx) => {
        for (let i = 0; i < drafts.length; i += chunk) await run(tx, drafts.slice(i, i + chunk));
      });
    else if (opts.atomic)
      fail('unsupported', undefined, [
        'insertMany({ atomic: true }) требует транзакции: транспорт её не даёт, а часть пачки уже могла бы записаться',
      ]);
    else
      for (let i = 0; i < drafts.length; i += chunk) await run(db, drafts.slice(i, i + chunk));
    return out;
  }
  const mutate = (
    ctx0: DataContext,
    op: 'insert' | 'update' | 'delete',
    id: unknown,
    input: unknown,
  ) =>
    db.guard(async () => {
      const ctx = context(ctx0);
      const needsTransaction = !!(r.hooks?.beforeWrite || r.hooks?.afterWrite || r.validateFinal);
      if (needsTransaction) {
        // На HTTP это отказывает ДО запроса/мутации, а не эмулирует atomic hooks.
        if (!db.driver.capabilities.transactions) throw new DbFailure('unsupported');
        return db.transaction((tx) => write(tx, ctx, op, id, input));
      }
      return write(db, ctx, op, id, input);
    });
  return {
    select: (ctx, input) => db.guard(async () => (await read(ctx, input)).items),
    cursor: (ctx, input) => db.guard(() => read(ctx, input, true)),
    get: (ctx, id, input = {}) =>
      db.guard(async () => {
        const value = id; // Единственная normalizer/schema проверка — в filter compiler.
        // PK должен быть разрешён для eq в descriptor, как и остальные клиентские фильтры.
        const row = (
          await read(ctx, {
            ...input,
            filter: { field: r.primaryKey, op: 'eq', value },
            limit: 1,
          })
        ).items[0];
        if (!row) fail('not_found');
        return row;
      }),
    count: (ctx0, input = {}) =>
      db.guard(async () => {
        const ctx = context(ctx0);
        readable(r, ctx);
        listInput(input);
        if (Object.keys(input).some((k) => !['filter', 'includeDeleted'].includes(k)))
          fail('validation');
        const s = new Sql(),
          predicate = await where(ctx, 'select', s, input.filter, input.includeDeleted);
        const n = Number(
          (
            await db.query(
              withSignal(
                s.statement(`SELECT count(*)::text AS n FROM ${table(r)} WHERE ${predicate}`),
                ctx,
              ),
            )
          ).rows[0].n,
        );
        if (!Number.isSafeInteger(n)) fail('database');
        return n;
      }),
    insert: (ctx, input) => mutate(ctx, 'insert', undefined, input),
    update: (ctx, id, input) => mutate(ctx, 'update', id, input),
    delete: (ctx, id) => mutate(ctx, 'delete', id, undefined),
    insertMany: (ctx, rows, opts) => db.guard(() => insertMany(ctx, rows, opts)),
    estimate: (ctx, input) => db.guard(() => estimate(ctx, input ?? {})),
  };
}
