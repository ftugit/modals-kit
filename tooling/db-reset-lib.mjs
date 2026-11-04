/** Сброс пользовательских таблиц public в выделенной БД; schema и её ACL не меняются. */
const quoteIdentifier = (name) => `"${name.replaceAll('"', '""')}"`

async function resetTablesInTransaction(client) {
    // Сериализует только другие сборки, использующие этот же скрипт; не рантайм.
    await client.query("SELECT pg_advisory_xact_lock(hashtext('modals-kit:db-reset:public'))")
    const { rows: schema } = await client.query("SELECT to_regnamespace('public') IS NOT NULL AS exists")
    if (!schema[0]?.exists) {
      throw new Error('схема public отсутствует; её должен создать владелец базы или провайдер')
    }
    const { rows: tables } = await client.query(`
      SELECT c.oid::text AS oid, c.relname AS name, c.relkind AS kind,
             EXISTS (SELECT 1 FROM pg_catalog.pg_depend d
                     WHERE d.classid = 'pg_catalog.pg_class'::regclass AND d.objid = c.oid
                       AND d.refclassid = 'pg_catalog.pg_extension'::regclass AND d.deptype = 'e') AS extension_owned
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'f')
      ORDER BY c.relname`)
    if (tables.some((t) => t.kind === 'f' || t.extension_owned)) {
      throw new Error('в public есть внешние или принадлежащие расширению таблицы; автоматический сброс остановлен')
    }
    if (tables.length) {
      const names = tables.map((t) => `public.${quoteIdentifier(t.name)}`).join(', ')
      // Запрещаем изменять найденные таблицы/их секции до проверки связей и DROP.
      // Некооперирующее создание *новых* независимых таблиц схема не блокирует.
      await client.query(`LOCK TABLE ${names} IN ACCESS EXCLUSIVE MODE`)
      const { rows: lockedTables } = await client.query(`
        SELECT c.oid::text AS oid, c.relname AS name
        FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'f') ORDER BY c.relname`)
      if (lockedTables.length !== tables.length || tables.some((t, i) =>
        t.oid !== lockedTables[i].oid || t.name !== lockedTables[i].name)) {
        throw new Error('набор таблиц public изменился во время сброса; автоматический сброс остановлен')
      }
      const { rows: cross } = await client.query(`
        SELECT 1 FROM pg_catalog.pg_inherits i
        JOIN pg_catalog.pg_class child ON child.oid = i.inhrelid
        JOIN pg_catalog.pg_namespace cn ON cn.oid = child.relnamespace
        JOIN pg_catalog.pg_class parent ON parent.oid = i.inhparent
        JOIN pg_catalog.pg_namespace pn ON pn.oid = parent.relnamespace
        WHERE (cn.nspname = 'public') <> (pn.nspname = 'public')
        LIMIT 1`)
      if (cross.length) {
        throw new Error('таблицы public связаны наследованием или секциями с другой схемой; автоматический сброс остановлен')
      }
      // RESTRICT запрещает удаление чужих представлений и внешних ключей.
      await client.query(`DROP TABLE ${names} RESTRICT`)
    }
    return tables.length
}

export async function resetPublicTables(client) {
  await client.query('BEGIN')
  try {
    const count = await resetTablesInTransaction(client)
    await client.query('COMMIT')
    return count
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  }
}

/** Полный поддерживаемый сброс объектов public. Неизвестные объекты => rollback,
 * никогда не считать очистку только таблиц успешным полным сбросом. Вызывать
 * только после внешнего эксклюзивного барьера на всю выделенную БД. */
export async function resetPublicObjects(client, options = {}) {
  const ownTransaction = !options.transactionStarted
  if (ownTransaction) await client.query('BEGIN')
  try {
    // Стабильные и квалифицированные regprocedure независимо от search_path.
    await client.query('SET LOCAL search_path = pg_catalog')
    const { rows: schema } = await client.query("SELECT to_regnamespace('public') IS NOT NULL AS exists")
    if (!schema[0]?.exists) throw new Error('схема public отсутствует; её должен создать владелец базы или провайдер')
    const { rows: views } = await client.query(`
      SELECT c.relname AS name, c.relkind AS kind FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind IN ('v','m') ORDER BY c.relname`)
    for (const [kind, command] of [['v', 'VIEW'], ['m', 'MATERIALIZED VIEW']]) {
      const names = views.filter((v) => v.kind === kind).map((v) => `public.${quoteIdentifier(v.name)}`)
      if (names.length) await client.query(`DROP ${command} ${names.join(', ')} RESTRICT`)
    }
    const { rows: routines } = await client.query(`
      SELECT p.oid::regprocedure::text AS signature, p.prokind AS kind FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' ORDER BY 1`)
    for (const [kind, command] of [['f', 'FUNCTION'], ['p', 'PROCEDURE'], ['a', 'AGGREGATE'], ['w', 'FUNCTION']]) {
      const names = routines.filter((r) => r.kind === kind).map((r) => r.signature)
      if (names.length) await client.query(`DROP ${command} ${names.join(', ')} RESTRICT`)
    }
    const tables = await resetTablesInTransaction(client)
    const { rows: sequences } = await client.query(`
      SELECT c.relname AS name FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind='S' ORDER BY c.relname`)
    if (sequences.length) await client.query(`DROP SEQUENCE ${sequences.map((s) => `public.${quoteIdentifier(s.name)}`).join(', ')} RESTRICT`)
    const { rows: types } = await client.query(`
      SELECT t.typname AS name, t.typtype AS kind FROM pg_catalog.pg_type t
      JOIN pg_catalog.pg_namespace n ON n.oid=t.typnamespace
      WHERE n.nspname='public' AND t.typrelid=0 AND t.typelem=0 AND t.typtype IN ('b','c','d','e','r','m') ORDER BY t.typname`)
    for (const [isDomain, command] of [[false, 'TYPE'], [true, 'DOMAIN']]) {
      const names = types.filter((t) => (t.kind === 'd') === isDomain).map((t) => `public.${quoteIdentifier(t.name)}`)
      if (names.length) await client.query(`DROP ${command} ${names.join(', ')} RESTRICT`)
    }
    const { rows: collations } = await client.query(`
      SELECT c.collname AS name FROM pg_catalog.pg_collation c JOIN pg_catalog.pg_namespace n ON n.oid=c.collnamespace
      WHERE n.nspname='public' ORDER BY c.collname`)
    if (collations.length) await client.query(`DROP COLLATION ${collations.map((c) => `public.${quoteIdentifier(c.name)}`).join(', ')} RESTRICT`)
    const { rows: remaining } = await client.query(`
      SELECT pg_catalog.pg_describe_object(d.classid,d.objid,d.objsubid) AS object
      FROM pg_catalog.pg_depend d WHERE d.refclassid='pg_catalog.pg_namespace'::regclass
        AND d.refobjid='public'::regnamespace AND d.deptype='n' LIMIT 1`)
    if (remaining.length) throw new Error('в public остались неподдерживаемые объекты; полный сброс отменён')
    if (ownTransaction) await client.query('COMMIT')
    return { tables, views: views.length, routines: routines.length, sequences: sequences.length, types: types.length, collations: collations.length }
  } catch (error) {
    if (ownTransaction) await client.query('ROLLBACK').catch(() => {})
    throw error
  }
}
