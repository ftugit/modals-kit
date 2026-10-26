# План: список seed-юзеров — компонент для роута, модалки и главной

**Задача.** Новый компонент списка seed-юзеров (`user_auth`): один экран работает
из модалки и с роута; на главной — отдельный entry-компонент, видимый только
авторизованным, внутри него кнопка, открывающая модалку (без JS — переход на роут).
Внутри списка о правах говорит сам экран списка (одинаково в обоих носителях).

**Состояние на старте.** Репозиторий `repos/modals-kit`, ветка `img`,
HEAD `1d79466`, дерево чистое. Node песочницы v20.20.2 при требуемых проектом
>=22.17 — Node v22.17.0 поставлен в `/tmp/node22` (`PATH=/tmp/node22/bin:$PATH`),
`npm ci` выполнен. Playwright пробы прошлого хода: реальный запуск Chromium — ок.

## Решения владельца (зафиксированы в диалоге)

| решение | значение |
|---|---|
| кто видит список | `admin` + держатели `account.read` |
| действия строки | только просмотр, действий нет |
| поля строки | только данные, которые DB отдаёт после ACL (проекция строки `user_auth`; технические `subnet_salt`/`security` в браузер не уходят) |
| пагинация | режим `accumulate`, URL-адаптер |
| entry на главной | видна только авторизованным (`vault.authorized`, не `Acl`); о правах говорит экран списка внутри модалки/роута |

## Решения реализации и причины

| решение | почему |
|---|---|
| экран один — `SeedUsersScreen` по образцу `ProfileScreen` | ветвление `fact / данные` пишется один раз на два носителя |
| отказ — данными (`fact`), не броском | брошенный `error(403)` не монтирует компонент модалки, `Acl` показать некому (прецедент профиля) |
| модалка без `loader`, только `route` | `preloadData` исполняет `load` роута; страница и модалка не расходятся |
| `account.read` добавляется в `policy.select` и в `readDeleted` модели `auth` | каталог прав (`permissions.ts`) обещает `account.read` «видеть любой аккаунт … вместе с удалёнными», а модель пока пускает только `server`/`admin`; `includeDeleted` без `readDeleted` падает `forbidden` (`resource.ts:232`) |
| доменная проверка права — до порта (`admin.ts`-стиль) | `ownerOrRoles` без права отдала бы юзеру его собственную строку, а не отказ: список обязан отказать целиком |
| список идёт от `principalOfRow` вызывающего, не от `SYSTEM` | иначе ACL модели не работает и «только данные после ACL» невыполнимо |
| первая порция — снапшот из `load` роута, догрузка — `GET /api/seed-users` | тот же конвейер, что у постов (`list.server.ts` + `/api/db-posts`): один доменный вызов `auth(event).listSeedUsers(page, size)` на SSR, data-запрос модалки и браузерную догрузку; глобальный server-transport с чужим ctx не заводим |
| `pageParam: 'users'` у URL-адаптера | не сталкиваться с `?page` подлежащей страницы и ключами `?modal.*` |
| entry на главной — `{#if vault.authorized}` | `Acl allow="user"` гостю рисует карточку «Войти», а не прячет блок (канон — `UserMenu`) |

## Команды

```sh
export PATH=/tmp/node22/bin:$PATH
node node_modules/.bin/svelte-kit sync
NODE_OPTIONS=--max-old-space-size=1250 node node_modules/.bin/svelte-check --tsconfig ./tsconfig.json
node node_modules/vitest/vitest.mjs run src/content/user          # узкий гейт модуля
node --test tooling/*.test.mjs                                     # стражи
npm run build                                                      # перед финальным коммитом
```

## Стадии

- [x] **S0. Среда и чек-лист.** Node 22 в `/tmp/node22`, `npm ci`, этот файл.
- [x] **S1. Домен и модель.** `account.read` в `policy.select` + `readDeleted`
      (`schema.ts`); тип строки списка и метод порта `listPage` (`ports.ts`,
      `types.ts`); домен `listSeedUsers` (`accounts.ts`: `guard` → отказ
      `auth.forbidden` без `admin`/`account.read` → страница от principal
      вызывающего); адаптер в `gateway.server.ts` (`select(page,limit,includeDeleted)`
      + `count`); фасад `auth(event).listSeedUsers`. Тесты: `accounts.test.ts`
      (нет входа / нет права / `account.read` / `admin` / пагинация),
      `schema.test.ts` (политика пускает `account.read`).
- [x] **S2. Источник, роут, эндпоинт.** `ui/seed-users/source.ts`
      (`defineSource`, `ensureSeedUsersPaginator`, URL-адаптер `users`,
      помощник снапшота первой порции); роут `/users`
      (`routes/(site)/(app)/users/+page.server.ts` — `load` → `SeedUsersScreenData`,
      `private, no-store`; `+page.svelte` — экран); `GET /api/seed-users`
      (тот же доменный вызов, `PageResponse` или отказ кодом).
      Тест помощника снапшота/источника.
- [x] **S3. Экран и модалка.** `SeedUsersScreen.svelte` (`fact → Acl`,
      `auth.forbidden → Acl model="forbidden"`, иначе `Paginator` + строка
      просмотра), `SeedUserRow`, `SeedUsersModal.svelte` (`useLoader`),
      `SeedUsersModalLazy.svelte`, регистрация `user.list` в `modals.ts`,
      `userListRoute` в `routes.ts`.
- [x] **S4. Entry на главной.** `SeedUsersEntry.svelte`
      (`{#if vault.authorized}`, `Button {asModalLink('user.list')}`),
      подключение в `routes/(site)/(app)/+page.svelte`.
- [x] **S5. Документация и полные гейты.** README `src/content/user/README.md`
      тем же коммитом (правило AGENTS.md §4); полный набор: `check`,
      `vitest src/content/user`, `node --test tooling/*.test.mjs`, `build`;
      браузерная проба против preview (гость: entry нет, `/users` — экран входа;
      модалка открывается по deep-link).

## Критерии приёмки

| # | критерий | проверка |
|---|---|---|
| 1 | один `load` обслуживает роут и модалку | в `registerModal('user.list')` нет `loader`; экран один — `SeedUsersScreen` |
| 2 | главная: гость блока не видит, авторизованный видит | браузерная проба `/` гостем и после входа; SSR-HTML гостя без entry |
| 3 | без права (`account.read`/`admin`) — экран о правах в обоих носителях | доменный тест (`auth.forbidden`) + проба роута/модалки |
| 4 | с правом — список, включая удалённые строки | доменный тест + тест политики |
| 5 | поля строки ⊆ ответа DB после ACL; `subnet_salt`/`security` наружу не уходят | тип `SeedUserView` + доменный тест проекции |
| 6 | `accumulate` + URL: догрузка пишет `?users=…`, первая порция видна из SSR без JS | браузерная проба роута (HTML + клик «показать ещё») |
| 7 | кнопка entry: с JS — модалка, без JS — роут | `asModalLink('user.list')`, `href` = `userListRoute.href()` |

## PROCEDURE

**Пять жёстких правил.**

1. Ни одной правки до версии: правки только в дереве под git, состояние закоммичено (`1d79466`).
2. Коммит положен, когда файлы вне `/tmp` изменились и хотя бы один гейт прошёл зелёным —
   триггер наблюдаемый, а не самооценка.
3. Слова «готово / работает / исправлено» без заполненного `<evidence_block>` не употребляются.
4. Невыполнимое требование называется вслух; тихо выброшенное — ложный отчёт.
5. После замечания пользователя: стоп, ответ, ожидание решения — без правок, пока решение не принято.

**VCS.** git есть; ветка `img`; HEAD `1d79466`; remote `origin` = `ftugit/modals-kit`;
коммиты только локальные, push — нет.

**Пропущенные требования.** Пока нет. Известное ограничение среды: Node 22 живёт в
`/tmp/node22` (эфемерно) — в новой сессии ставить заново.

## Ход работ

| стадия | результат |
|---|---|
| S0 | Node v22.17.0 (`/tmp/node22`), `npm ci` ок, чек-лист создан; гейт tooling 145/0; коммит `6b7fea2` |
| S4+S5 | `SeedUsersEntry` на главной, README модуля; полные гейты: svelte-check 0/0, vitest `src/content/user` 117/117, tooling fail 0, `vite build` ок; браузерная проба против preview: гость (entry нет, модалка и роут — экран входа), обычный юзер (entry видна, модалка и роут — «Доступ запрещён», API 403), админ (строки в модалке и на роуте, API-пагинация порциями без пересечений) |
| S2+S3 | источник `seed-users` (URL-адаптер `?users`), снапшот первой порции из `load`, роут `/users`, `GET /api/seed-users`, `SeedUsersScreen`, модалка `user.list` без `loader`; гейты: svelte-check 0/0, vitest `src/content/user` 117/117 |
| S1 | `accounts.ts` (`listSeedUsers`), `listPage` в порте и gateway от principal вызывающего, `account.read` в `policy.select`+`readDeleted`; тесты `accounts.test.ts`+`schema.test.ts`+`admin.test.ts` — 10/10 |

## Следующий шаг

Работа завершена; следующий шаг — за владельцем (просмотр, push).
