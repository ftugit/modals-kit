// Запуск: node src/lib/db/probes/chain-acl.sim.mjs (из корня проекта). Итог — README §7 «Ключи доступа».
// Симуляция «права через связь» (проектирование ключей доступа, ходы 212–215) на PGlite.
// SQL собирается так, как его собирал бы компилятор правил: узел `via(поле, правило)` —
// EXISTS по первичному ключу связанной таблицы с её правилом внутри (рекурсивно).
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
await db.exec(`
create table users (id text primary key);
create table collections (id text primary key, owner_id text not null references users,
  read_mode text not null, post_mode text not null, deleted_at timestamptz);
create table categories (id text primary key, collection_id text not null references collections, name text);
create table posts (id text primary key, collection_id text not null references collections,
  category_id text references categories, author_id text not null references users,
  comment_mode text not null, deleted_at timestamptz);
create table comments (id text primary key, post_id text not null references posts,
  author_id text not null references users, body text, deleted_at timestamptz);
create index on comments(post_id); create index on posts(collection_id); create index on categories(collection_id);
insert into users values ('A'),('B'),('C');
insert into collections values ('K','A','all','all',null),('K2','C','all','all',null);
insert into categories values ('cat','K','общая'),('cat2','K2','чужая');
insert into posts values ('P','K','cat','B','all',null),('P2','K','cat','B','post_owner',null);
insert into comments values ('c1','P','C','от C',null),('c2','P','B','от B',null);
`)

// ---- модели: таблица, мягкое удаление, правила (ctx → предикат над алиасом) ----
let n = 0
const q = (v) => `'${String(v).replace(/'/g, "''")}'`
const M = {}
const via = (field, model, rule) => (ctx, a) => {
  const t = M[model], b = `v${++n}`
  const live = t.soft ? ` AND ${b}.deleted_at IS NULL` : ''
  // правило цели всегда вместе с её правилом чтения: что не видно — недоступно
  const inner = rule === 'select' ? t.rules.select(ctx, b) : `(${t.rules.select(ctx, b)}) AND (${t.rules[rule](ctx, b)})`
  return `EXISTS (SELECT 1 FROM ${t.table} ${b} WHERE ${b}.id = ${a}.${field}${live} AND (${inner}))`
}
const or = (...xs) => (ctx, a) => xs.map((x) => `(${x(ctx, a)})`).join(' OR ')
const and = (...xs) => (ctx, a) => xs.map((x) => `(${x(ctx, a)})`).join(' AND ')
const eq = (field, v) => (ctx, a) => `${a}.${field} = ${q(typeof v === 'function' ? v(ctx) : v)}`
const me = (ctx) => ctx.me

M.collection = { table: 'collections', soft: true, rules: {
  select: or(eq('read_mode', 'all'), eq('owner_id', me)),
  update: eq('owner_id', me),
  delete: eq('owner_id', me),
  createPost: or(eq('post_mode', 'all'), eq('owner_id', me)),
} }
M.category = { table: 'categories', soft: false, rules: {
  select: via('collection_id', 'collection', 'select'),
  insert: via('collection_id', 'collection', 'update'),
  update: via('collection_id', 'collection', 'update'),
  delete: via('collection_id', 'collection', 'update'),
} }
M.post = { table: 'posts', soft: true, rules: {
  select: via('collection_id', 'collection', 'select'),
  insert: via('collection_id', 'collection', 'createPost'),
  update: and(via('collection_id', 'collection', 'select'), or(eq('author_id', me), via('collection_id', 'collection', 'update'))),
  delete: and(via('collection_id', 'collection', 'select'), or(eq('author_id', me), via('collection_id', 'collection', 'update'))),
  comment: or(eq('comment_mode', 'all'),
    and(eq('comment_mode', 'post_owner'), eq('author_id', me)),
    and(eq('comment_mode', 'collection_owner'), via('collection_id', 'collection', 'update'))),
} }
M.comment = { table: 'comments', soft: true, rules: {
  // видно: через запись (кто читает запись) ИЛИ своё (через авторство)
  select: or(via('post_id', 'post', 'select'), eq('author_id', me)),
  insert: via('post_id', 'post', 'comment'),
  // править — автор комментария и только пока запись доступна
  update: and(eq('author_id', me), via('post_id', 'post', 'select')),
  delete: and(via('post_id', 'post', 'select'), or(eq('author_id', me), via('post_id', 'post', 'update'))),
} }

// ---- операции модели ----
const live = (t, a) => (t.soft ? `${a}.deleted_at IS NULL` : 'TRUE')
async function list(model, ctx, where = 'TRUE') {
  const t = M[model]
  const r = await db.query(`SELECT x.id FROM ${t.table} x WHERE ${live(t, 'x')} AND (${t.rules.select(ctx, 'x')}) AND (${where}) ORDER BY x.id`)
  return r.rows.map((x) => x.id)
}
// вставка: правило insert проверяется по НОВЫМ значениям (как WITH CHECK)
async function insert(model, ctx, row) {
  const t = M[model], cols = Object.keys(row)
  const vals = `SELECT ${cols.map((c) => `${q(row[c])}::text AS ${c}`).join(', ')}`
  const r = await db.query(`INSERT INTO ${t.table} (${cols}) SELECT * FROM (${vals}) x WHERE ${t.rules.insert(ctx, 'x')} RETURNING id`)
  return r.rows.length ? 'ok' : 'отказ: связь недоступна'
}
async function update(model, ctx, id, set) {
  const t = M[model]
  const assigns = Object.entries(set).map(([k, v]) => `${k} = ${q(v)}`).join(', ')
  // правило по старой строке (кто может) + по новой (куда переносим), как USING/WITH CHECK
  const moved = M[model].rules.insert && Object.keys(set).some((k) => k.endsWith('_id'))
  await db.exec('BEGIN')
  const r = await db.query(`UPDATE ${t.table} x SET ${assigns} WHERE x.id = ${q(id)} AND ${live(t, 'x')} AND (${t.rules.update(ctx, 'x')}) RETURNING id`)
  if (r.rows.length && moved) {
    const ok = await db.query(`SELECT 1 FROM ${t.table} x WHERE x.id = ${q(id)} AND (${t.rules.insert(ctx, 'x')})`)
    if (!ok.rows.length) { await db.exec('ROLLBACK'); return 'отказ: новая связь недоступна' }
  }
  await db.exec('COMMIT')
  return r.rows.length ? 'ok' : 'отказ'
}
async function canDelete(model, ctx, where) {
  const t = M[model]
  const r = await db.query(`SELECT count(*)::int AS total, count(*) FILTER (WHERE ${t.rules.delete(ctx, 'x')})::int AS allowed FROM ${t.table} x WHERE ${live(t, 'x')} AND (${where})`)
  return r.rows[0]
}
// цепочка: коллекция → категории, записи → комментарии
async function chain(ctx, collectionId) {
  const links = [
    ['collection', `x.id = ${q(collectionId)}`],
    ['category', `x.collection_id = ${q(collectionId)}`],
    ['post', `x.collection_id = ${q(collectionId)}`],
    ['comment', `x.post_id IN (SELECT id FROM posts WHERE collection_id = ${q(collectionId)})`],
  ]
  const out = []
  for (const [m, w] of links) out.push({ model: m, ...(await canDelete(m, ctx, w)) })
  const blocked = out.find((l) => l.allowed !== l.total)
  return { links: out, verdict: blocked ? `упёрлось в ${blocked.model}: ${blocked.total - blocked.allowed} из ${blocked.total}` : 'можно' }
}

const A = { me: 'A' }, B = { me: 'B' }, C = { me: 'C' }
const log = (name, v) => console.log(name.padEnd(64), JSON.stringify(v))

console.log('— коллекция K «для всех» —')
log('1. C: комментарии записи P (по связи)', await list('comment', C, `x.post_id = 'P'`))
log('2. C: все комментарии без фильтра', await list('comment', C))
log('3. C: пишет к P напрямую, запись не загружал (mode all)', await insert('comment', C, { id: 'c3', post_id: 'P', author_id: 'C', body: 'x' }))
log('4. C: пишет к P2 (mode post_owner)', await insert('comment', C, { id: 'c4', post_id: 'P2', author_id: 'C', body: 'x' }))
log('5. B: пишет к P2 (автор записи)', await insert('comment', B, { id: 'c5', post_id: 'P2', author_id: 'B', body: 'x' }))
log('6. A: пишет к P2 (создатель коллекции, mode post_owner)', await insert('comment', A, { id: 'c6', post_id: 'P2', author_id: 'A', body: 'x' }))
log('7. C: пишет к несуществующей записи', await insert('comment', C, { id: 'c7', post_id: 'NOPE', author_id: 'C', body: 'x' }))
log('8. C: правит свой c1', await update('comment', C, 'c1', { body: 'правка' }))
log('9. C: правит чужой c2', await update('comment', C, 'c2', { body: 'правка' }))
log('10. C: переносит свой c1 на P2 (туда ему писать нельзя)', await update('comment', C, 'c1', { post_id: 'P2' }))
log('11. B: создаёт запись в K с категорией из чужой K2', await insert('post', B, { id: 'P3', collection_id: 'K', category_id: 'cat2', author_id: 'B', comment_mode: 'all' }))

await db.exec(`update collections set read_mode = 'owner' where id = 'K'`)
console.log('— A сделал K «для создателя» —')
log('12. C: комментарии записи P (по связи)', await list('comment', C, `x.post_id = 'P'`))
log('13. C: все комментарии без фильтра (обход через форму запроса)', await list('comment', C))
log('14. C: «мои комментарии» (по авторству)', await list('comment', C, `x.author_id = 'C'`))
log('15. C: правит свой c1', await update('comment', C, 'c1', { body: 'ещё' }))
log('16. C: пишет к P напрямую', await insert('comment', C, { id: 'c8', post_id: 'P', author_id: 'C', body: 'x' }))
log('17. B (автор P, не создатель K): видит свою запись P?', await list('post', B, `x.id = 'P'`))
log('18. B: комментарии своей записи P', await list('comment', B, `x.post_id = 'P'`))
log('19. A: комментарии записи P', await list('comment', A, `x.post_id = 'P'`))
log('20. B: цепочка удаления коллекции K', await chain(B, 'K'))
log('21. A: цепочка удаления коллекции K', await chain(A, 'K'))

await db.exec(`update collections set read_mode = 'all' where id = 'K'`)
log('22. B: удалить свою P с чужим комментарием c1 (canDelete)', await canDelete('comment', B, `x.post_id = 'P'`))
await db.exec(`update posts set deleted_at = now() where id = 'P'`)
log('23. P мягко удалена. C: пишет к P', await insert('comment', C, { id: 'c9', post_id: 'P', author_id: 'C', body: 'x' }))
log('24. C: «мои комментарии» после удаления P', await list('comment', C, `x.author_id = 'C'`))

console.log('— план запроса «комментарии записи» (10k записей, 50k комментариев) —')
await db.exec(`insert into users select 'u'||g from generate_series(1,100) g;
insert into posts select 'p'||g,'K',null,'u'||(g%100+1),'all',null from generate_series(1,10000) g;
insert into comments select 'k'||g,'p'||(g%10000+1),'u'||(g%100+1),'t',null from generate_series(1,50000) g; analyze;`)
const plan = await db.query(`EXPLAIN SELECT x.id FROM comments x WHERE x.deleted_at IS NULL AND (${M.comment.rules.select(C, 'x')}) AND x.post_id = 'p5'`)
console.log(plan.rows.map((r) => r['QUERY PLAN']).join('\n'))
