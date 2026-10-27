# `src/content/user` — модуль пользователя (вход по seed, сессии, профиль, ACL)

Автономный доменный модуль приложения: Ed25519-подпись `seed` по запечатанному challenge-токену (stateless, без серверного хранилища nonce), оба токена сессии в `HttpOnly`-куках, клиентское зеркало `access` в RAM (`vault`), таблицы аккаунтов/сессий/профилей в `#lib/db`, UI ACL на 21 экран и маршрутно-независимые формы компонентов через `#hooks/component-form`.

---

## Модуль приложения, а не библиотека

Папка в `src/content/` принадлежит предметной области «пользователь» (наравне с `demo-catalog/posts/posts.ts` и источниками каталогов), а не переиспользуемому слою `src/lib/`. В одном месте собраны ресурсы БД, чистые доменные функции, адаптеры портов, серверный фасад кук и самодостаточные UI-компоненты.

## Состав

| Путь | Назначение |
|---|---|
| `schema.ts` | Три ресурса `#lib/db`: `user_auth` (`seed`, времена + soft delete, блокировки `blocked`, соль подсетей), `user_profile` (неуникальный никнейм с запрещённым списком, `avatar_url`), `user_session` (`jti`, имя устройства, хэш подсети + история, `last_seen_at`, отзыв = soft delete). Разворачиваются через `schemaSpec` в `src/server/db.server.ts`. |
| `keys.ts` | Изоморфная криптография `@noble/ed25519`: `generateKeyPair`, `seedOf`, `sign`, `verify`. |
| `types.ts` | Клеймы токенов, `SessionRecord`, `ProfileView`, `LoginOutcome`, `Blocked`. |
| `ports.ts` | Контракты портов: `sessions`, `auths`, `profiles`, `config`, `seal`, `cookies`, `clock`. |
| `auth.ts` | Доменный API входа и сессий: `issueChallenge`, `login`, `restoreDeleted`, `verifySeed` (проверка владения `seed` без создания сессии), `guard`, `renew`, `logout`, `logoutAll`, `listSessions`, `revokeSession`, `requestDelete`, `sweepDeletions`. |
| `profile.ts` | Профильный API отдельно от `auth.ts`: `profile` (чтение: строка + признак `notCreated` — владелец/права чтения отличают «не создан» от отказа), `updateProfile`, доменная проверка аватара по заголовку (`probeImageHeader`). |
| `spec-profile.ts` | Тексты-заглушки профиля одним объектом (образец — `spec-avatar.ts`): нет никнейма, не создан, нет аватара. Потребители — `ProfileCard`, экран «не создан», меню, строка seed-списка. |
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
| `ui/ProfileScreen.svelte` | Экран чтения профиля (этапы 3+4) — единственное место, где данные `load` превращаются в экран: `fact` → `<Acl status>`, `profile` → `<ProfileCard>` (все поля, только чтение), `notCreated` → заглушка «профиль не создан» текстами `spec-profile.ts`, пусто иначе → `<Acl model="not_found">` («строки нет» и «не видна» без прав не различаются). Общий для страницы `/user/[id]` и модалки `user.profile`; редактирование живёт в виджете входа (`stage=profile`) и вернётся сюда этапом 7. |
| `ui/ProfileCard.svelte` | Карточка чтения профиля: зона идентичности (аватар/инициал, никнейм, короткий id аккаунта) и детали всеми полями `ProfileView` (времена — `TimeAgo`); пустые значения — тексты единой спеки `spec-profile.ts` (её же строки берут экран «не создан», меню и строка seed-списка). |
| `accounts.ts` | Список seed-юзеров: `listSeedUsers(ports, token, {page, pageSize})` — порции `user_auth` от principal вызывающего; нужны `admin` или `account.read` (доменная проверка даёт `auth.forbidden`, модель — `policy.select` и `readDeleted` с тем же правом, поэтому видны и удалённые строки). Технические поля строки (`subnet_salt`, `security`) в выдачу не входят. Этап 2: параметр `nickname` действует только при праве читать профили (флаг `canSeeNickname`: admin / `profile.read` / `profile.edit` — та же политика, что политика чтения модели профиля); с ним в выдаче появляется `nickname` (профиль подтягивает слой include по уникальному `auth_id`), поиск совпадает по seed, по id и (при параметре) по никнейму, порядок уходит в путь `profile.nickname`; без права домен параметр игнорирует, поля никнейма в выдаче нет. Потолок порции домена — 100. |
| `ui/SeedUsersScreen.svelte` + `ui/seed-users/` | Экран списка по образцу `ProfileScreen`: `fact` → `<Acl>` (о правах говорит сам экран, одинаково в обоих носителях), иначе пагинатор (`accumulate`, URL-адаптер `?users`, источник `seed-users`). Первая порция — снапшот из `load` роута `/users`, догрузка — `preloadData` на тот же `/users?users=N` (того же `load`); REST-роута у списка нет, все пути сходятся в `listSeedUsers`. Этап 1: над списком поиск (`SearchBar`, родной поиск источника — подстрока seed/id на сервере) и кнопка модалки `user.list.filters` (порядок по доступным временам и id, диапазоны создания/удаления, состояние удалённости при `canSeeDeleted`; счётчик применённых умолчания адаптера не считает; включённый параметр никнейма и не-умолчальный размер порции считаются). Дополнение к этапу 2: порядок в форме — первым пунктом, справа от него — целое поле размера порции (30–100, `setPageSize` в модалке, `users.size` в адресе), пары «от/до» и пара «порядок/размер» разложены flex-сегментами с переносом по образцу шапки сайта. Этап 2: при `canSeeNickname` в форме фильтров — чекбокс «Показывать никнейм» (`users.nick`), опции порядка по никнейму гейтятся им через `Option.when` кита форм (сброс на умолчание при выключении — контракт кита); в строке — столбец никнейма (заглушка `specProfile.nicknameMissing`, если ника/профиля нет; этапы 3+4), подпись поиска обещает и никнейм; список без разделителей страниц, зоны подгрузки сверху/снизу — 40%, скелетоны догрузки повторяют геометрию строки (блок никнейма в них — только при включённом параметре); блоки строки делят ширину поровну и при сжатии прокручиваются внутри блока вместо троеточия, время создания показывает компонент `TimeAgo` («N минут/дней назад», старше месяца — дата); ключи среза объявлены адресному слою (`SEED_USERS_EXTRA_SEARCH` + дефолты в регистрации пагинатора — без объявления URL-адаптер их в адрес не пишет и не восстанавливает); срез собирает домен в `Filter`/`Order` слоя БД, подстроку seed применяет адаптер (схема поля — 43–44 знака, DB-фильтр её не примет). Роут и модалка `user.list` делят один `load` (`route` без `loader`); вся карточка строки — ссылка на профиль (JS — модалка `user.profile` поверх, без JS — роут `/user/<id>`; этапы 3+4). No-JS: модалка фильтров имеет `route` `/users/filters` (канон `user.menu`), кнопка несёт `href` с `from` = текущий адрес носителя списка; страница фильтров (`SeedUsersFiltersForm` — общая форма модалки и страницы) предзаполняется из `from` и уходит нативным GET обратно на носитель, чужие ключи адреса (поиск, `modal=…`, размер) едут скрытыми полями, указатель порции сбрасывается. Loader-кеш списка смену сессии не переживает: auth-модалка при завершении входа сбрасывает кеш загрузчиков модалок, а модалка списка сама инвалидирует свой кеш, если снимок содержит сессионный `fact`, а `vault` уже авторизован. |
| `ui/SeedUsersEntry.svelte` | Точка входа на главной: видна только авторизованным (`vault.authorized`, без `Acl` — гостю блока нет и в SSR), кнопка `asModalLink('user.list')` — с JS модалка, без JS ссылка на `/users`. Права здесь не проверяются: о них говорит экран списка. |
| `ui/ProfileModal.svelte` | Профиль в модалке (регистрация — `lazy(() => import(...))`, готовность ждёт данные и чанк): своего `loader` нет — данные приносит `load` маршрута `/user/[id]` через `preloadData` по `route` модалки; компонент читает их `useLoader()` и отдаёт в `ProfileScreen`. |
| `ui/BanNotice.svelte` / `ui/RestrictionsNotice.svelte` | Экраны полной блокировки (`scope: 'auth'`) и частичных ограничений аккаунта. |
| `ui/AuthWidget.svelte` | Тонкий координатор шагов потока входа (`auth.*` / `blocked` / `restrictions` / `profile`, адрес — `?stage=auth.restore`) + связка `formSteps`. |
| `ui/MenuBody.svelte` / `ui/MenuModal.svelte` / `ui/UserMenu.svelte` | Меню пользователя под `<Acl allow="user">` (аватар, никнейм из спеки при пустом, чтение своего профиля — модалка `user.profile`/роут `/user/<id>`, переход к `?stage=profile`, выход) и кнопка в шапке. На узкой ширине аватар открывает меню модалкой `user.menu`; на широкой — всплывашку `host.floating` без URL (без JS — страница `/user/menu`). |
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
