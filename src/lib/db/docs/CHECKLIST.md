# db-port — адаптация `server/lib/db` (SolidHono) для `modals-kit` (SvelteKit)

Документ передачи. Он рассчитан на агента/разработчика **без** доступа к чату:
всё, что нужно для продолжения, описано здесь.

## 0. Исходная задача (дословно от пользователя)

> задание: адаптируй от solidhono для modal-kit серверную lib/db.
> изучи как у SvelteKit вообще используется база данных, насколько совместимы lib/db.
> modal-kit получит в будущем обновление так что переноси отдельно, а не сразу в него.
> забыл добавить, что я хочу чтобы ты изучил интернет, github и другие источники
> на возможность улучшения кода у адаптации db.

Эталонные ревизии (даны ссылками на коммиты):

- SolidHono `f8079b19a4fa6150728a3dc685fc148e2175666a` — «feat(shikimori): финальная сборка…»,
  кончик ветки `origin/shiki-final` (внутри него вся история `main`).
- modals-kit `f82734f08aa95757a562ee6255586af011a375d8` — «fix(select): keep mobile multiselect
  taps on native control», кончик ветки `origin/b1` (внутри него вся история `main`).

**Ключевое ограничение:** `modals-kit` будет обновляться, поэтому перенос живёт
ОТДЕЛЬНО (`/home/user/db-port`) и в дерево `modals-kit` не писалось до явного
согласия владельца.

**Снятие правила (09.10.2026):** владелец решил не держать `lib` бд отдельно — слой
переехал в `src/lib/db` этого приложения как обычный `lib`, история порта сохранена в
`/home/user/db-port-history.bundle`. Ниже `db-port` — это прошлое. Настоящие команды:
`npm run test:db`, `npm run check`, `npm run build`, пробы — `node --import tsx
src/lib/db/probes/<имя>.probe.mjs`.

## 1. Состояние окружения (проверено, не предположение)

| Свойство | Значение |
|---|---|
| Песочница | Debian 13 trixie, x86_64, 2 CPU, 1.9 GiB RAM, 21 GiB свободно |
| Node / npm | v20.20.2 / 10.8.2 (`pnpm`, `yarn`, `bun`, `deno`, `go`, `rustc` — нет) |
| git | 2.47.3 |
| python | 3.13.16 |
| `/tmp` | `tmpfs` (оперативка, эфемерно) — ничего постоянного туда не класть |
| Персистентно | только файлы внутри `/home/user`, кроме исключённых каталогов (`node_modules`, `dist`, `.cache`, …) |
| Playwright | есть: `playwright@1.64.0` (npx-кэш `~/.npm/_npx/e41f203b7505f1fb`), chromium-headless-shell `156.0.8078.4` |
| Проверка Playwright | реальная операция выполнена: `setContent` → `$eval` → `PAGE_VALUE=42:ok` → `close()` → `PLAYWRIGHT_OK` (`/home/user/tools/pw-check.mjs`) |
| Сеть | npm registry и github.com доступны (200) |
| sudo | есть, без пароля (использовался для установки системных зависимостей браузера) |

Важно: `node_modules` и кэш Playwright **не входят** в снапшот рабочего
пространства. Если песочница пересоздана, зависимости переставляются командой из §6.

## 2. Репозитории

```
/home/user/repos/solidhono   HEAD work/f8079b1 = f8079b1   (origin = https://github.com/ftugit/SolidHono.git, токен вычищен)
/home/user/repos/modal-kit   HEAD work/f82734f = f82734f  (origin = https://github.com/ftugit/modals-kit.git, токен вычищен)
```

- Оба репозитория клонированы по PAT'у пользователя; `origin` переписан на чистый
  URL (`grep github_pat .git/config` → пусто). **Ничего не пушится** — коммиты только локальные.
- В обоих — чистое дерево, работа ведётся на локальных ветках `work/*`.

## 3. Что именно переносится

Источник: `server/lib/db/` SolidHono (17 файлов, ~2000 строк) — independent-of-HTTP
SQL-компилятор + resource-слой:

```
adapters/pg.ts        пул node-postgres, admission cap, дедлайн транзакции
adapters/pglite.ts    обёртка над уже открытым PGlite
adapters/proxy-*.ts   транспорт Juit pgproxy (HTTPS без транзакций / WSS с ними)
adapters/shared.ts    runTransaction/scope: savepoint'ы, «отравленный» parent, COMMIT-tag
cursor/codec.ts       HMAC-SHA256 cursor: версия, kid, TTL, scope (principal+policy+…)
database.ts           createDb: limits-контракт, guard, onError+observerTimeout, afterCommit-очередь
errors.ts             DbFailure(kind, details), normalizeFailure (только структурный SQLSTATE), presentFailure
policy.ts             publicRows / roles / ownerOrRoles / deny
query/sql.ts          ident/table/col/expr/projection, Sql(параметры), readable, orderBy/orderSQL, filterSQL, keyset
resource.ts           select/get/count/cursor/insert/update/delete, hooks, includes(LATERAL), soft delete
sqlstate.ts           каталог SQLSTATE PostgreSQL 18 (262 записи)
types.ts              контракты: Driver, Capabilities, Field, Resource, Limits, StandardSchema
validation.ts         budget/isRecord/context/freeze, draftInput/revalidateDraft, field()/f.* (zod), defineResource
index.ts              barrel (драйверы намеренно не реэкспортируются)
```

Зависимости источника: `zod@4.6.5`, `@electric-sql/pglite@0.5.8`, `pg@8.23.0`,
`@juit/pgproxy-client[-whatwg]@1.5.1` (+ `@types/pg`).
В `modals-kit` из этого нет **ничего** (в lock-файле есть только
`@standard-schema/spec@1.1.0` как транзитивная).

## 4. Решение по совместимости (краткая выжимка; подробности в отчёте)

Совместимо «из коробки», менять не нужно:

1. Ядро не знает про Hono: `lib/db` не импортирует `hono` — только `Request`-агностичные
   контракты (`DataContext`, `Statement`). HTTP-обвязка SolidHono (`server/modules/probe/rest.ts`,
   `SolidHono/server/runtime/*.ts`, `SolidHono/tooling/vite/db.mjs`) остаётся за переносом и заменяется
   идиомами SvelteKit (`+page.server.ts`, `actions`, `event.locals`, `$lib/server`).
2. `$lib/server/*` уже даёт серверную границу сборки → «vite-dbBuildPlugin» не нужен.
3. `normalizeValue` (Date→ISO, bigint→string) = сериализуемость в `data` SvelteKit (devalue).
4. Standard Schema (`~standard`) — тот же контракт, что у SvelteKit 2 / `+page.server.ts`
   и у собственного `$lib/form/schema.ts` в `modals-kit`.
5. Миграции не автоматические, только `src/lib/db/migrations/*.sql` + явный прогон.

Расхождения, которые надо закрыть в порте (см. §7): `@server/*` алиасы, `zod` как
обязательная зависимость, `presentFailure` (Hono Response) → `error()/fail()`,
отсутствие AbortSignal, пул `max: 4` на serverless, PGlite/`pg` и цель Cloudflare,
`afterCommit` на бессерверном рантайме.

## 5. Итоговое состояние (S4–S10 выполнены)

Пакет: `/home/user/db-port` = `@ftugit/kit-db@0.1.0`, 3 231 строка TS в `src/` (тогда; теперь это `src/lib/db`).
Коммиты: `7e5324a` (каркас + копия ядра), `e453c8b` (ядро без zod + Hyperdrive +
SvelteKit-слой), `f0eb10b` (перенесённый baseline db-lib 16/16), далее — сборки/тесты/док.

- `npm run check` зелёный: `tsc --noEmit` (0 ошибок) + `npm run build` (dist + `.d.ts` +
  `tooling/db-docs.mjs`, 19 файлов) + `node test/run.mjs` → **файлов: 5/5, упавших: 0**
  (structure 6, port-specific 15, ported db-followup 8, db-hardening 5, db-lib 16 = 50 групп).
- `npm pack` → `ftugit-kit-db-0.1.0.tgz`; установлен в копию `modals-kit`
  (`/home/user/integration`) вместе с `@electric-sql/pglite@0.5.8 pg@8.23.0` →
  `npx svelte-kit sync && npx svelte-check` = **0 ошибок** / 45 warning (все предсуществующие).
- Реальный браузер (Playwright + chromium) на `/db-demo`: SSR-таблица без JS, ошибка поля
  `Too small: …` + `aria-invalid`, вставка (7→8), удаление через `use:enhance` (6→5),
  `?filter`/`?order`/`?limit`, неизвестный ключ → 422, `/` жив; `BROWSER_OK`.
- `dist/` прогонян голым Node против настоящего PGlite (select/count/contains/validation/
  toFormFailure) — т.е. публикуемая сборка, а не только `src`, behaves.

Ответы пользователя, определившие API (вопросы Q1–Q4 в чате):
**Q1** = pg + pglite + hyperdrive; **Q2** = zero-dep Standard Schema, zod опционален
(`$lib/db/zod`); **Q3** = lib + hooks + типы + демо-роут; **Q4** = отдельный
пакет-зависимость (не патч в дерево).

## 5.1 Решения и отвергнутые варианты

| Решение | Почему |
|---|---|
| Отдельный npm-пакет, в `modals-kit` не пишем | требование пользователя; обновление приложения не конфликтует с портом |
| Ядро в `src/lib/db/**`, SvelteKit-слой в `src/lib/db/sveltekit/**` | ядро остаётся диффимым против источника (см. `PORTING.md` §1) |
| `./sveltekit` без `node:`/`pg`/PGlite-импортов, `./sveltekit/node` — с ними | универсальный вход можно использовать в Workers; нарушение ловит `structure.check.mts` |
| Баррель не реэкспортирует адаптеры | клиентская/edge сборка не тянет драйверы |
| `toKitError`/`toFormFailure` возвращают данные, а не бросают kit-ошибки | пакет не зависит от `@sveltejs/kit` в рантайме; augment `App.Error`/`App.Locals` делает приложение |
| `DataContext` frozen, передаётся только из хука | ALS для запросного состояния в Kit отвергнут; роль нельзя должить телом запроса |
| `typescript` в пакете закреплён на 5.9.3 | SolidHono на 5.9.3, `modals-kit` на `^6`; публикуемые `.d.ts` проходят и там, и там |
| `tsconfig.json` исключает `test/ported` | это дословные порты JS-эпохи: идут через `tsx`, не типизируются |
| `dist` (default) + `source` (для `ssr.noExternal`) | голый Node/Vite SSR внешние deps не транспилирует: `src`-only публикация упала бы в рантайме |

Отвергнуто эмпирически (не чинить; подробности — `PORTING.md` §7): «несовпадение порядка
`$n` и значений в `filterSQL`», «`expr()` сдвигает UTC», «`keyset()` теряет хвост NULL».
Мёртвая ветка: переписывать перенесённые проверки на vitest — такой тест проверяет
стенд-замену, а не порт; использованы тела `test/checks/db-*.mjs` источника. использованы тела `test/checks/db-*.mjs` источника.

## 6. Команды

```sh
# зависимости песочницы (если кэш пропал)
cd /home/user/db-port && npm i -D tsx typescript@5.9.3 @types/node @types/pg @standard-schema/spec \
  && npm i zod@4.6.5 @electric-sql/pglite@0.5.8 pg@8.23.0

# проги-зонды (реальный исходник через tsx, без сборки проекта)
cd /home/user/db-port/probe && npx --no-install tsx order.probe.mts
cd /home/user/db-port/probe && npx --no-install tsx pglite.probe.mts

# SolidHono: штатные проверки db (vite-сборка фикстуры + PGlite/native pg)
cd /home/user/repos/solidhono && npm i && npm run check:db-lib
```

## 7. План стадий (все закрыты, кроме публикаций в registry — они вне скоупа)

- [x] S1. Окружение + Playwright-проверка; клоны на эталонных коммитах; `origin` очищен.
- [x] S2. Обследование `server/lib/db` + `modals-kit`; вывод о совместимости (§4).
- [x] S3. Зонды кандидатов в улучшения на реальном коде (3 опровергнуты).
- [x] S4. Перенос ядра в `src/lib/db/**` с относительными импортами, баррель без драйверов.
- [x] S5. SvelteKit-слой: `dbHandle`, `App.*`-augmentation, `toKitError`/`toFormFailure`,
      `Statement.signal` ← `event.request.signal`.
- [x] S6. Валидация без обязательного zod: `@standard-schema/spec` + `src/lib/db/schema.ts`;
      zod — отдельный опциональный вход.
- [x] S7. Рантайм-конфиг: `openPgPool` (serverless-дефолты), `openNodeDatabase` (lock/memory),
      `hyperdriveAdapter` (клиент на запрос, fail-fast).
- [x] S8. Миграции: `splitSqlStatements` + `applyMigrationText`, явный прогон; `001/002` как образец.
- [x] S9. Тесты: `node test/run.mjs` (50 групп) + `svelte-check` на реальном приложении + Playwright.
- [x] S10. Документация: `README.md` (API/идиомы SvelteKit) + `PORTING.md` (карта «файл → файл»,
      снятые проверки, ре-синхронизация). `apply.sh`/`format-patch` не нужны — поставка пакетом.

## 8. Что осталось незакрытым (осознанно)

1. Публикации в реестр нет: `private: false`, `prepublishOnly` и tarball готовы; имя
   `$lib/db` локальное.
2. RLS (`SET LOCAL role`) — вне пакета: второй эшелон, зона ответственности схемы/миграций
   приложения (обоснование — `PORTING.md` §3).
3. Juit/pgproxy-адаптеры не перенесены; исходники — `server/lib/db/adapters/proxy*.ts`
   на `f8079b1` в клоде источника.
4. Реального Postgres в песочнице нет: путь `pg` покрыт стабами источника +
   построением/закрытием пула, поведение под нагрузкой (пул + bouncer) не измерять здесь.
5. PAT'ы пользователя, выданные в чате для клона, всё ещё живы — отозвать их нужно
   на стороне GitHub (в `origin` токенов нет, `grep github_pat` в обоих клодах пуст).

## 9. Следующий шаг (если продолжать)

Ре-синхронизация с upstream — команды и правила в `PORTING.md` §8. Если понадобится
демо-роут в самом `modals-kit` (по явному согласию владельца), он переносится из
`/home/user/integration/src/routes/db-demo/**` + `src/lib/server/db.ts` +
`src/hooks.server.ts` и `src/app.d.ts` (три файла — все грабли перечислены в `PORTING.md` §9).
Перед любой правкой, меняющей сборку/публичный API, обязательны все проверки `PORTING.md` §5 (тесты → dist-смоук → svelte-check → браузер).
