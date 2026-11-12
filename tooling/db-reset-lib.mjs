/** Сброс пользовательских таблиц public в выделенной БД; schema и её ACL не меняются. */
const quoteIdentifier = (name) => `"${name.replaceAll('"', '""')}"`

/**
 * Объект считается принадлежащим расширению, если у него есть зависимость
 * типа 'e' от pg_extension. На managed-провайдерах расширения ставят прямо в
 * public: Clever Cloud кладёт туда pg_stat_statements и pg_stat_kcache, а их
 * объекты принадлежат роли postgres. Сброс обязан пропускать такие объекты,
 * а не пытаться их удалить: роль приложения ими не владеет, да и удалять
 * мониторинг провайдера никому не нужно.
 */
const EXTENSION_OWNED = `EXISTS (SELECT 1 FROM pg_catalog.pg_depend d
  WHERE d.classid = $CLASSID$ AND d.objid = $OBJID$
    AND d.refclassid = 'pg_catalog.pg_extension'::regclass AND d.deptype = 'e')`

const ownedByExtension = (classId, objId) =>
  EXTENSION_OWNED.replace('$CLASSID$', `'pg_catalog.${classId}'::regclass`).replace('$OBJID$', objId)

/** Владение объектом: DROP требует владельца или роли, членом которой он является. */
const ownedByCurrentRole = (ownerColumn) => `pg_has_role(current_user, ${ownerColumn}, 'USAGE')`

async function resetTablesInTransaction(client) {
    // Сериализует только другие сборки, использующие этот же скрипт; не рантайм.
    await client.query("SELECT pg_advisory_xact_lock(hashtext('modals-kit:db-reset:public'))")
    const { rows: schema } = await client.query("SELECT to_regnamespace('public') IS NOT NULL AS exists")
    if (!schema[0]?.exists) {
      throw new Error('схема public отсутствует; её должен создать владелец базы или провайдер')
    }
    const { rows: tables } = await client.query(`
      SELECT c.oid::text AS oid, c.relname AS name, c.relkind AS kind,
             ${ownedByExtension('pg_class', 'c.oid')} AS extension_owned,
             ${ownedByCurrentRole('c.relowner')} AS owned_by_role
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'f')
      ORDER BY c.relname`)
    // Внешние таблицы не дропаем никогда: за ними стоит чужой источник данных.
    if (tables.some((t) => t.kind === 'f' && !t.extension_owned)) {
      throw new Error('в public есть внешние таблицы; автоматический сброс остановлен')
    }
    // Чужие таблицы, не принадлежащие расширению, — тоже стоп: сброс не должен
    // уничтожать объекты, которыми роль не владеет.
    const foreign = tables.filter((t) => !t.extension_owned && !t.owned_by_role)
    if (foreign.length) {
      throw new Error('в public есть таблицы, не принадлежащие роли сброса; автоматический сброс остановлен')
    }
    const own = tables.filter((t) => !t.extension_owned)
    if (own.length) {
      const names = own.map((t) => `public.${quoteIdentifier(t.name)}`).join(', ')
      // Запрещаем изменять найденные таблицы/их секции до проверки связей и DROP.
      // Некооперирующее создание *новых* независимых таблиц схема не блокирует.
      await client.query(`LOCK TABLE ${names} IN ACCESS EXCLUSIVE MODE`)
      const { rows: lockedTables } = await client.query(`
        SELECT c.oid::text AS oid, c.relname AS name
        FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'f') ORDER BY c.relname`)
      // Сверяем только свои таблицы: объекты расширений в список не входили.
      const lockedOwn = lockedTables.filter((t) => own.some((o) => o.oid === t.oid))
      if (lockedOwn.length !== own.length || own.some((t, i) =>
        t.oid !== lockedOwn[i].oid || t.name !== lockedOwn[i].name)) {
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
    return own.length
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
      SELECT c.relname AS name, c.relkind AS kind,
             ${ownedByExtension('pg_class', 'c.oid')} AS extension_owned,
             ${ownedByCurrentRole('c.relowner')} AS owned_by_role
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind IN ('v','m') ORDER BY c.relname`)
    const ownViews = views.filter((v) => !v.extension_owned)
    if (ownViews.some((v) => !v.owned_by_role)) {
      throw new Error('в public есть представления, не принадлежащие роли сброса; автоматический сброс остановлен')
    }
    for (const [kind, command] of [['v', 'VIEW'], ['m', 'MATERIALIZED VIEW']]) {
      const names = ownViews.filter((v) => v.kind === kind).map((v) => `public.${quoteIdentifier(v.name)}`)
      if (names.length) await client.query(`DROP ${command} ${names.join(', ')} RESTRICT`)
    }
    const { rows: routines } = await client.query(`
      SELECT p.oid::regprocedure::text AS signature, p.prokind AS kind,
             ${ownedByExtension('pg_proc', 'p.oid')} AS extension_owned,
             ${ownedByCurrentRole('p.proowner')} AS owned_by_role
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' ORDER BY 1`)
    const ownRoutines = routines.filter((r) => !r.extension_owned)
    if (ownRoutines.some((r) => !r.owned_by_role)) {
      throw new Error('в public есть процедуры, не принадлежащие роли сброса; автоматический сброс остановлен')
    }
    for (const [kind, command] of [['f', 'FUNCTION'], ['p', 'PROCEDURE'], ['a', 'AGGREGATE'], ['w', 'FUNCTION']]) {
      const names = ownRoutines.filter((r) => r.kind === kind).map((r) => r.signature)
      if (names.length) await client.query(`DROP ${command} ${names.join(', ')} RESTRICT`)
    }
    const tables = await resetTablesInTransaction(client)
    const { rows: sequences } = await client.query(`
      SELECT c.relname AS name,
             ${ownedByExtension('pg_class', 'c.oid')} AS extension_owned,
             ${ownedByCurrentRole('c.relowner')} AS owned_by_role
      FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind='S' ORDER BY c.relname`)
    const ownSequences = sequences.filter((s) => !s.extension_owned)
    if (ownSequences.some((s) => !s.owned_by_role)) {
      throw new Error('в public есть последовательности, не принадлежащие роли сброса; автоматический сброс остановлен')
    }
    if (ownSequences.length) await client.query(`DROP SEQUENCE ${ownSequences.map((s) => `public.${quoteIdentifier(s.name)}`).join(', ')} RESTRICT`)
    const { rows: types } = await client.query(`
      SELECT t.typname AS name, t.typtype AS kind,
             ${ownedByExtension('pg_type', 't.oid')} AS extension_owned,
             ${ownedByCurrentRole('t.typowner')} AS owned_by_role
      FROM pg_catalog.pg_type t
      JOIN pg_catalog.pg_namespace n ON n.oid=t.typnamespace
      WHERE n.nspname='public' AND t.typrelid=0 AND t.typelem=0 AND t.typtype IN ('b','c','d','e','r','m') ORDER BY t.typname`)
    const ownTypes = types.filter((t) => !t.extension_owned)
    if (ownTypes.some((t) => !t.owned_by_role)) {
      throw new Error('в public есть типы, не принадлежащие роли сброса; автоматический сброс остановлен')
    }
    for (const [isDomain, command] of [[false, 'TYPE'], [true, 'DOMAIN']]) {
      const names = ownTypes.filter((t) => (t.kind === 'd') === isDomain).map((t) => `public.${quoteIdentifier(t.name)}`)
      if (names.length) await client.query(`DROP ${command} ${names.join(', ')} RESTRICT`)
    }
    const { rows: collations } = await client.query(`
      SELECT c.collname AS name,
             ${ownedByExtension('pg_collation', 'c.oid')} AS extension_owned,
             ${ownedByCurrentRole('c.collowner')} AS owned_by_role
      FROM pg_catalog.pg_collation c JOIN pg_catalog.pg_namespace n ON n.oid=c.collnamespace
      WHERE n.nspname='public' ORDER BY c.collname`)
    const ownCollations = collations.filter((c) => !c.extension_owned)
    if (ownCollations.some((c) => !c.owned_by_role)) {
      throw new Error('в public есть collations, не принадлежащие роли сброса; автоматический сброс остановлен')
    }
    if (ownCollations.length) await client.query(`DROP COLLATION ${ownCollations.map((c) => `public.${quoteIdentifier(c.name)}`).join(', ')} RESTRICT`)
    // Хвост: в public не должно остаться ничего, кроме объектов расширений и
    // самих расширений — их сброс не создавал и удалять не вправе.
    const { rows: remaining } = await client.query(`
      SELECT pg_catalog.pg_describe_object(d.classid,d.objid,d.objsubid) AS object
      FROM pg_catalog.pg_depend d WHERE d.refclassid='pg_catalog.pg_namespace'::regclass
        AND d.refobjid='public'::regnamespace AND d.deptype='n'
        AND d.classid <> 'pg_catalog.pg_extension'::regclass
        AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend e
          WHERE e.classid = d.classid AND e.objid = d.objid
            AND (e.objsubid = d.objsubid OR e.objsubid = 0)
            AND e.refclassid = 'pg_catalog.pg_extension'::regclass AND e.deptype = 'e')
      LIMIT 1`)
    if (remaining.length) throw new Error('в public остались неподдерживаемые объекты; полный сброс отменён')
    if (ownTransaction) await client.query('COMMIT')
    return { tables, views: ownViews.length, routines: ownRoutines.length, sequences: ownSequences.length, types: ownTypes.length, collations: ownCollations.length }
  } catch (error) {
    if (ownTransaction) await client.query('ROLLBACK').catch(() => {})
    throw error
  }
}
