/** Сброс пользовательских таблиц public в выделенной БД; schema и её ACL не меняются. */
const quoteIdentifier = (name) => `"${name.replaceAll('"', '""')}"`

export async function resetPublicTables(client) {
  await client.query('BEGIN')
  try {
    // Сериализует только другие сборки, использующие этот же скрипт; не рантайм.
    await client.query("SELECT pg_advisory_xact_lock(hashtext('modals-kit:db-reset:public'))")
    const { rows: schema } = await client.query("SELECT to_regnamespace('public') IS NOT NULL AS exists")
    if (!schema[0]?.exists) {
      throw new Error('схема public отсутствует; её должен создать владелец базы или провайдер')
    }
    const { rows: tables } = await client.query(`
      SELECT c.relname AS name, c.relkind AS kind,
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
      // Один DROP позволяет удалить таблицы с взаимными внешними ключами. RESTRICT
      // намеренно запрещает каскадное удаление представлений или чужих объектов.
      await client.query(`DROP TABLE ${tables.map((t) => `public.${quoteIdentifier(t.name)}`).join(', ')} RESTRICT`)
    }
    await client.query('COMMIT')
    return tables.length
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  }
}
