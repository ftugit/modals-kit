// Запуск: node src/lib/db/probes/chain-acl-keys.sim.mjs (из корня проекта). Итоги — docs/design/model-automation.md §14.
// Симуляция «права по переданным ключам» (модель владельца, ходы 214–215): права связи
// включаются ключом, переданным в запрос; без ключей — всё (это ORM, а не API). Ключ «владелец» —
// сравнить с текущим пользователем; ключ «запись» — спросить у записи её правило. Вставка —
// все ключи обязательны и проходят все. Изменение/удаление по id — ключи из самой строки,
// достаточно одного разрешающего (автор ИЛИ тот, кому разрешает запись).
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
await db.exec(`
create table collections (id text primary key, owner_id text not null, read_mode text not null, post_mode text not null, deleted_at timestamptz);
create table posts (id text primary key, collection_id text not null references collections, author_id text not null,
  comment_mode text not null, deleted_at timestamptz);
create table comments (id text primary key, post_id text not null references posts, author_id text not null, body text, deleted_at timestamptz);
create index on comments(post_id); create index on comments(author_id);
insert into collections values ('K','A','all','all',null);
insert into posts values ('P','K','B','all',null),('P2','K','B','post_owner',null),('PX','K','B','all',null);
insert into comments values ('c1','P','C','от C',null),('c2','P','B','от B',null),('c3','PX','C','от C',null),('c4','P','C','удалён',now());
`)
const q = (v) => `'${String(v).replace(/'/g, "''")}'`

// Правила записи — один раз на значение ключа, а не на каждую строку.
const postRules = {
  select: (me, p) => `EXISTS (SELECT 1 FROM posts p JOIN collections k ON k.id = p.collection_id
    WHERE p.id = ${q(p)} AND p.deleted_at IS NULL AND k.deleted_at IS NULL AND (k.read_mode = 'all' OR k.owner_id = ${q(me)}))`,
  comment: (me, p) => `(${postRules.select(me, p)}) AND EXISTS (SELECT 1 FROM posts p JOIN collections k ON k.id = p.collection_id
    WHERE p.id = ${q(p)} AND (p.comment_mode = 'all' OR (p.comment_mode = 'post_owner' AND p.author_id = ${q(me)})
      OR (p.comment_mode = 'collection_owner' AND k.owner_id = ${q(me)})))`,
  update: (me, p) => `(${postRules.select(me, p)}) AND EXISTS (SELECT 1 FROM posts p JOIN collections k ON k.id = p.collection_id
    WHERE p.id = ${q(p)} AND (p.author_id = ${q(me)} OR k.owner_id = ${q(me)}))`,
}
const ask = async (sql) => (await db.query(`SELECT (${sql}) AS ok`)).rows[0].ok

// Ключи доступа модели комментария.
const access = {
  author_id: { check: async (me, v) => v === me },                       // «владелец» = я
  // правило записи по операции комментария; нет правила — ключ эту операцию не разрешает
  post_id: { rules: { select: 'select', insert: 'comment', delete: 'update' },
    check: async (me, v, op) => { const r = access.post_id.rules[op]; return r ? ask(postRules[r](me, v)) : false } },
}
const ERR = 'отказ'
async function list(me, keys) {
  const used = Object.keys(keys).filter((k) => k in access)
  if (!used.length) return (await db.query(`SELECT id FROM comments WHERE deleted_at IS NULL ORDER BY id`)).rows.map((r) => r.id)
  for (const k of used) if (!(await access[k].check(me, keys[k], 'select'))) return `${ERR}: ${k} недоступен`
  const where = used.map((k) => `${k} = ${q(keys[k])}`).join(' AND ')
  return (await db.query(`SELECT id FROM comments WHERE deleted_at IS NULL AND ${where} ORDER BY id`)).rows.map((r) => r.id)
}
async function insert(me, row) {
  for (const k of Object.keys(access)) {
    if (!(k in row)) return `${ERR}: не передан ${k}`
    if (!(await access[k].check(me, row[k], 'insert'))) return `${ERR}: ${k} недоступен`
  }
  await db.query(`INSERT INTO comments (id, post_id, author_id, body) VALUES (${q(row.id)}, ${q(row.post_id)}, ${q(row.author_id)}, 'x')`)
  return 'ok'
}
// Изменение/удаление по id: ключи — из самой строки; достаточно одного разрешающего.
async function byId(me, id, op) {
  const row = (await db.query(`SELECT * FROM comments WHERE id = ${q(id)} AND deleted_at IS NULL`)).rows[0]
  if (!row) return `${ERR}: нет строки`
  for (const k of Object.keys(access)) if (await access[k].check(me, row[k], op)) return `ok (разрешил ${k})`
  return `${ERR}: ни один ключ не разрешает`
}
// Удаление цепочкой от записи: у комментария правило удаления «я автор ИЛИ правлю запись».
async function canDeleteForPost(me, post) {
  const canEditPost = await ask(postRules.update(me, post))
  const r = (await db.query(`SELECT count(*)::int total, count(*) FILTER (WHERE author_id = ${q(me)})::int own FROM comments WHERE post_id = ${q(post)} AND deleted_at IS NULL`)).rows[0]
  return { total: r.total, allowed: canEditPost ? r.total : r.own }
}

const log = (name, v) => console.log(name.padEnd(70), JSON.stringify(v))
console.log('— коллекция K «для всех» —')
log('1. C: список без ключей', await list('C', {}))
log('2. C: «мои» (author_id=C)', await list('C', { author_id: 'C' }))
log('3. C: чужие «мои» (author_id=B)', await list('C', { author_id: 'B' }))
log('4. C: комментарии записи P (post_id=P)', await list('C', { post_id: 'P' }))
log('5. C: мои в P (post_id=P, author_id=C)', await list('C', { post_id: 'P', author_id: 'C' }))
log('6. C: пишет к P без author_id', await insert('C', { id: 'n1', post_id: 'P' }))
log('7. C: пишет к P от имени B', await insert('C', { id: 'n2', post_id: 'P', author_id: 'B' }))
log('8. C: пишет к P от себя', await insert('C', { id: 'n3', post_id: 'P', author_id: 'C' }))
log('9. C: пишет к P2 (режим «автор записи»)', await insert('C', { id: 'n4', post_id: 'P2', author_id: 'C' }))
log('10. C: правит c1 (свой)', await byId('C', 'c1', 'update'))
log('11. C: правит c2 (чужой)', await byId('C', 'c2', 'update'))
log('11a. B (автор записи P): удаляет чужой c1', await byId('B', 'c1', 'delete'))
log('11b. B: правит чужой c1', await byId('B', 'c1', 'update'))
await db.exec(`update collections set read_mode = 'owner' where id = 'K'`)
console.log('— A сделал K «для создателя» —')
log('12. C: «мои» (author_id=C) — даже если выкинули', await list('C', { author_id: 'C' }))
log('13. C: комментарии записи P (post_id=P)', await list('C', { post_id: 'P' }))
log('14. C: мои в P (оба ключа)', await list('C', { post_id: 'P', author_id: 'C' }))
log('15. C: правит свой c1', await byId('C', 'c1', 'update'))
log('15a. C: все комментарии без ключей', await list('C', {}))
log('16. C: пишет к P', await insert('C', { id: 'n5', post_id: 'P', author_id: 'C' }))
log('17. A: комментарии записи P', await list('A', { post_id: 'P' }))
log('18. B (автор P): комментарии своей записи P', await list('B', { post_id: 'P' }))
await db.exec(`update collections set read_mode = 'all' where id = 'K'`)
log('19. B: удалить свою P цепочкой (комментарии)', await canDeleteForPost('B', 'P'))
log('20. C: удалить чужую P цепочкой', await canDeleteForPost('C', 'P'))
await db.exec(`update posts set deleted_at = now() where id = 'PX'`)
log('21. PX мягко удалена. C: «мои»', await list('C', { author_id: 'C' }))
log('22. C: комментарии PX', await list('C', { post_id: 'PX' }))
