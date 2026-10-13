# Окружение для проб `lib/db` (настоящий PostgreSQL, пулер, прокси)

Рецепты перенесены из чеклиста переноса (`CHECKLIST-2.md` §0, удалён в ходе 109). Песочница
не сохраняет `node_modules`, `/tmp` и запущенные процессы — после её пересоздания всё
поднимается заново. Обычные тесты (`npx vitest run`) идут на PGlite и этого окружения не
требуют.

## PostgreSQL 17 (нативный)

Нужен для `pg-live.probe.mjs`, `transport-matrix.probe.mjs`, `shikimori-view.probe.mjs`,
`testdb-encoding.probe.mjs` и прогона перенесённых тестов на настоящем PG.

```bash
sudo -n apt-get install -y --no-install-recommends postgresql postgresql-client
sudo -n -u postgres /usr/lib/postgresql/17/bin/initdb -D /tmp/pgdata -A trust -U postgres \
  --encoding=UTF8 --locale=C.UTF-8
/usr/lib/postgresql/17/bin/pg_ctl -D /tmp/pgdata \
  -o "-p 5433 -k /tmp -c listen_addresses=127.0.0.1" -l /tmp/pg.log start
for d in kitdb kitdb_lib kitdb_follow shikidb; do psql -h /tmp -p 5433 -U postgres -c "create database $d"; done
```

- `--encoding=UTF8` обязателен: без него кластер выходит `SQL_ASCII`, и `lower()`/`ILIKE`
  складывают регистр только по ASCII (`testdb-encoding.probe.mjs`). Для этой пробы нужны ещё
  `kitdb_utf` (`--encoding=UTF8 --locale=C.UTF-8`) и `kitdb_ascii` (`--encoding=SQL_ASCII`),
  обе из `template0`.
- Перенесённые тесты на настоящем PG: `DB_LIB_TEST_PG_URL=… DB_HARDENING_PG_URL=…`; базы
  обязаны быть свежими («requires fresh database»).

## PgBouncer (для `pooler.probe.mjs`)

```bash
sudo -n apt-get install -y --no-install-recommends pgbouncer
mkdir -p /tmp/pgb && cat > /tmp/pgb/pgbouncer.ini <<'INI'
[databases]
kitdb = host=/tmp port=5433 dbname=kitdb user=postgres
[pgbouncer]
listen_addr = 127.0.0.1
listen_port = 6432
unix_socket_dir = /tmp/pgb
auth_type = any            # НЕ trust: в pgbouncer «trust» читается как имя метода и ломает вход
pool_mode = transaction    # тот же режим, что у Supabase shared pooler / Hyperdrive
default_pool_size = 4
server_reset_query = DISCARD ALL
ignore_startup_parameters = options,statement_timeout   # без неё строки A1–A3 падают FATAL — это и есть вывод
INI
/usr/sbin/pgbouncer /tmp/pgb/pgbouncer.ini &
POOLER_URL=postgres://postgres@127.0.0.1:6432/kitdb \
  DIRECT_URL=postgres://postgres@127.0.0.1:5433/kitdb node src/lib/db/probes/pooler.probe.mjs
```

## Juit pgproxy (HTTP + WS, для `transport-matrix.probe.mjs`)

```bash
mkdir -p ~/pgproxy-lab && cd ~/pgproxy-lab
npm i @juit/pgproxy-server @juit/pgproxy-cli @juit/pgproxy-client @juit/pgproxy-client-whatwg ws pg
PGPROXYSECRET=<не короче 32 символов> PGPROXYADDRESS=127.0.0.1 PGPROXYPORT=5434 PGPROXYHEALTHCHECK=/healthz \
  PGHOST=/tmp PGPORT=5433 PGDATABASE=kitdb PGUSER=postgres ./node_modules/.bin/pgproxy-server --debug
curl http://127.0.0.1:5434/healthz   # → 200 {"available":1,…}
```

## Превью демо (`/db-demo`, `/paginator`) с курсором

```bash
npx vite build
DB_CURSOR_SECRET=$(openssl rand -hex 24) PREVIEW_PORTS=4173 npx vite preview --host 127.0.0.1 --port 4173 --strictPort
```

- `DB_CURSOR_SECRET` читается из переменных процесса, а не из `.env`. Короче 32 байт —
  отказ конфига (`DB_CURSOR_SECRET непригоден`), без него курсорный режим отвечает 501.
- Порт превью должен быть в `PREVIEW_PORTS`, иначе Kit отвечает 403 на POST формы.
- Перед `npx vitest run` превью останавливают: каталог PGlite занят блокировкой, и тесты
  слоя падают на `[vitest-pool]: Worker forks emitted error`. После сборки превью
  перезапускают: старый серверный бандл ссылается на удалённые ассеты.
- Перенесённый каталог PGlite иногда не открывается («PGlite failed to initialize
  properly») — каталог удаляют, данные вернутся миграцией и сидом. Замок мёртвого владельца
  (`.kit-db.lock`) снимается сам.
