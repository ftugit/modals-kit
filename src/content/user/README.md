# `src/content/user` — модуль пользователя (вход по seed, сессии, профиль, ACL)

Автономный доменный модуль приложения: Ed25519-подпись `seed` по одноразовому `challenge`, оба токена сессии в `HttpOnly`-куках, клиентское зеркало `access` в RAM (`vault`), таблицы аккаунтов/сессий/профилей в `#lib/db`, UI ACL на 21 экран и маршрутно-независимые формы компонентов через `#hooks/component-form`.

---

## Модуль приложения, а не библиотека

Папка в `src/content/` принадлежит предметной области «пользователь» (наравне с `demo-catalog/posts/posts.ts` и источниками каталогов), а не переиспользуемому слою `src/lib/`. В одном месте собраны ресурсы БД, чистые доменные функции, адаптеры портов, серверный фасад кук и самодостаточные UI-компоненты.

## Состав

| Путь | Назначение |
|---|---|
| `schema.ts` | Три ресурса `#lib/db`: `user_auth` (`seed`, времена + soft delete, блокировки `blocked`, соль подсетей), `user_profile` (неуникальный никнейм с запрещённым списком, `avatar_url`), `user_session` (`jti`, имя устройства, хэш подсети + история, `last_seen_at`, отзыв = soft delete). Разворачиваются через `schemaSpec` в `src/server/db.server.ts`. |
| `keys.ts` | Изоморфная криптография `@noble/ed25519`: `generateKeyPair`, `seedOf`, `sign`, `verify`. |
| `types.ts` | Клеймы токенов, `SessionRecord`, `ProfileView`, `LoginOutcome`, `Blocked`. |
| `ports.ts` | Контракты портов: `challenge`, `sessions`, `auths`, `profiles`, `config`, `seal`, `cookies`, `clock`. |
| `auth.ts` | Доменный API входа и сессий: `issueChallenge`, `login`, `restoreDeleted`, `verifySeed` (проверка владения `seed` без создания сессии), `guard`, `renew`, `logout`, `logoutAll`, `listSessions`, `revokeSession`, `requestDelete`, `sweepDeletions`. |
| `profile.ts` | Профильный API отдельно от `auth.ts`: `profile`, `updateProfile`, доменная проверка аватара по заголовку (`probeImageHeader`). |
| `checks.ts` | Общие проверки полей и спецификация `AVATAR_PHOTO_SPEC` (`#components/form/photo.js`). |
| `config.ts` | Настройки модуля поверх `#lib/cache` (`accessTtlSec`, `deviceTtlSec`, `challengeTtlSec`, `deleteGraceDays`, `avatarEdge`, `avatarMaxBytes`, `nicknameForbidden`, `holdSeconds`). |
| `error.ts` | Доменные факты `auth.*` / `profile.*` и перевод в инструкции формы (`instruction`). |
| `gateway.server.ts` | Серверная обвязка SvelteKit: адаптеры портов к `db.resource(user_*)`, запечатывание `iron-webcrypto`, фасад `auth(event)` (включая сериализованный `renew` по `withRenewLock` и лёгкий `refreshAccess` без ротации сессии), `resolveVault`, `readVault`, `vaultPayloadOf`, `toHttpStatus`. |
| `acl.ts` | Логика и описания 21 экрана `resolveAcl`: статусы субъекта/аккаунта (`guest`, `user`, роли, `auth_disabled`, бан, ограничения, удаление) и все отказы моделей `#lib/db` (`FailureKind` + `payload_too_large`). |
| `vault.ts` / `vault.svelte.ts` | Единый реактивный стор `vault` на лексическом замыкании (только публичные метаданные `{ sub, iat, expiresAt, ttlMs, prof }`, без сырых токенов), межвкладочная координация `navigator.locks` + `localStorage` + `BroadcastChannel`, пробуждение по `visibilitychange`/`online` и адаптер `userSession` для защищённых форм. |
| `ui/Acl.svelte` | Компонент защиты экрана: при срабатывании ограничения отображает карточку причины и штатное действие вместо `children`. |
| `ui/field-mirror.svelte.ts` | `mirrorToField(bound, имя, value)` — зеркало внешнего значения в поле формы: стартовое пишется синхронно (SSR и no-JS показывают его в HTML), дальше — эффектом; вид поля читается ВНЕ эффекта, иначе любой ввод перетирался бы зеркалом. |
| `ui/seed-form/` | Папочный модуль формы `seedForm` (`SeedForm.svelte`, `form.ts`, `envelope.ts`, `seed.form.server.ts`, `index.ts`): срезы `entry` / `register` / `restore` (`authorize = true`, `<Acl allow="guest">`) и срез `confirm` (`authorize = false` — проверка знания `seed` через `verifySeed` без открытия сессии и без смены кук, доступна и гостю, и залогиненному пользователю). |
| `ui/profile-form/` | Папочный модуль формы `profileForm` (`ProfileForm.svelte`, `AvatarTakeover.svelte`, `avatar.ts`, `form.ts`, `profile.form.server.ts`, `index.ts`): никнейм + бинарное поле `field.photo` с компактным `FileAttachment`/`Attachment`, удержанием отправки через `f.pending` и серверной обработкой через `decodeWithNode` (`#lib/image/node.js`) без передачи `base64` по сети. |
| `ui/ProfileScreen.svelte` | Экран профиля — единственное место, где данные `load` превращаются в экран: `fact` → `<Acl status>`, `profile` → `<ProfileForm subject>`, пусто при `fact === null` → `<Acl model="not_found">` («строки нет» и «не видна» модель не различает). Общий для страницы `/user/[id]` и модалки `user.profile`. |
| `accounts.ts` | Список seed-юзеров: `listSeedUsers(ports, token, {page, pageSize})` — порции `user_auth` от principal вызывающего; нужны `admin` или `account.read` (доменная проверка даёт `auth.forbidden`, модель — `policy.select` и `readDeleted` с тем же правом, поэтому видны и удалённые строки). Технические поля строки (`subnet_salt`, `security`) в выдачу не входят. |
| `ui/SeedUsersScreen.svelte` + `ui/seed-users/` | Экран списка по образцу `ProfileScreen`: `fact` → `<Acl>` (о правах говорит сам экран, одинаково в обоих носителях), иначе пагинатор (`accumulate`, URL-адаптер `?users`, источник `seed-users`). Первая порция — снапшот из `load` роута `/users`, догрузка — `preloadData` на тот же `/users?users=N` (того же `load`); REST-роута у списка нет, все пути сходятся в `listSeedUsers`. Этап 1: над списком поиск (`SearchBar`, родной поиск источника — подстрока seed на сервере) и кнопка модалки `user.list.filters` (порядок по доступным временам и id, диапазоны создания/удаления, состояние удалённости при `canSeeDeleted`); ключи среза объявлены адресному слою (`SEED_USERS_EXTRA_SEARCH` + дефолты в регистрации пагинатора — без объявления URL-адаптер их в адрес не пишет и не восстанавливает); срез собирает домен в `Filter`/`Order` слоя БД, подстроку seed применяет адаптер (схема поля — 43–44 знака, DB-фильтр её не примет). Роут и модалка `user.list` делят один `load` (`route` без `loader`), строка — только просмотр. No-JS: модалка фильтров имеет `route` `/users/filters` (канон `user.menu`), кнопка несёт `href` с `from` = текущий адрес носителя списка; страница фильтров (`SeedUsersFiltersForm` — общая форма модалки и страницы) предзаполняется из `from` и уходит нативным GET обратно на носитель, чужие ключи адреса (поиск, `modal=…`, размер) едут скрытыми полями, указатель порции сбрасывается. |
| `ui/SeedUsersEntry.svelte` | Точка входа на главной: видна только авторизованным (`vault.authorized`, без `Acl` — гостю блока нет и в SSR), кнопка `asModalLink('user.list')` — с JS модалка, без JS ссылка на `/users`. Права здесь не проверяются: о них говорит экран списка. |
| `ui/ProfileModal.svelte` / `ui/ProfileModalLazy.svelte` | Профиль в модалке: своего `loader` нет — данные приносит `load` маршрута `/user/[id]` через `preloadData` по `route` модалки; компонент читает их `useLoader()` и отдаёт в `ProfileScreen`. |
| `ui/BanNotice.svelte` / `ui/RestrictionsNotice.svelte` | Экраны полной блокировки (`scope: 'auth'`) и частичных ограничений аккаунта. |
| `ui/AuthWidget.svelte` | Тонкий координатор шагов потока входа (`auth.*` / `blocked` / `restrictions` / `profile`, адрес — `?stage=auth.restore`) + связка `formSteps`. |
| `ui/MenuBody.svelte` / `ui/MenuModal.svelte` / `ui/UserMenu.svelte` | Меню пользователя под `<Acl allow="user">` (аватар, никнейм, переход к `?stage=profile`, выход) и кнопка в шапке. На узкой ширине аватар открывает меню модалкой `user.menu`; на широкой — всплывашку `host.floating` без URL (без JS — страница `/user/menu`). |
| `index.ts` | Публичная точка входа доменного ядра. |

---

## Цепочка вызова

```
POST <любой маршрут> (__form_id = user-seed | user-profile)
  ─> componentFormsHandle (src/hooks/component-form/server.server.ts)
  ─> execute (ui/seed-form/seed.form.server.ts | ui/profile-form/profile.form.server.ts)
  ─> gateway auth(event) ─> core api (auth.ts / profile.ts) ─> факт { code, path?, args? }

любая страница (SSR): +layout.server.ts ─> resolveVault(event) ─> data.user + authStamp ─> vault
```

Ядро (`auth.ts`, `profile.ts`) не знает `Request` и `Cookies`: на входе данные и порты, на выходе результат или доменный факт.

---

## Выключение без секрета

Если `AUTH_SEAL_SECRET` не задан, подсистема входа мягко выключается без `500`: `<Acl enabled={false} />` показывает экран «Вход временно отключён», `resolveVault` возвращает `null`, а серверные обработчики отвечают `auth.disabled` (`503`) на все действия, кроме `logout`.

---

## Генерация `seed` при создании аккаунта

- **С JavaScript** — ключ генерируется локально в браузере (`generateKeyPair()` в `AuthWidget.svelte`) при переключении шага без обращения к серверу; приватный материал не попадает в HTML-ответ.
- **Без JavaScript / по прямой ссылке `?stage=auth.register`** — `registerSeed` создаёт сервер в `load`, и `SeedForm` показывает явное предупреждение, что ключ присутствовал в HTML ответа.

## Приватность и известные ограничения

- Полный IP-адрес не сохраняется никогда: в сессии пишется только `SHA-256` подсети (`/24` для IPv4, `/48` для IPv6) с индивидуальной солью аккаунта и код страны.
- Исполнитель окончательной зачистки `sweepDeletions` реализован в `auth.ts`; подключение к расписанию — обязанность приложения ([`docs/pending.md`](../../../docs/pending.md)). Судьба байтов аватара из куки `auth_tmp` — [`docs/pending.md`](../../../docs/pending.md) и [`docs/design/image-transfer.md`](../../../docs/design/image-transfer.md).
