# `src/content/user` — модуль пользователя (вход по seed, сессии, профиль)

Статус: **реализован** (ходы 252–257; решения владельца — `docs/design/auth-seed.md`,
чек-лист §6). Вход по seed-подписи (Ed25519), обе сессии-токена в HttpOnly-куках,
access зеркалится в RAM-vault браузера, сессии/аккаунты/профили — таблицы `lib/db`.

## Модуль, не библиотека

Папка в `src/content/` — модуль ПРИЛОЖЕНИЯ (как `posts.ts`): принадлежит домену
«пользователь», а не переиспользуемому слою. Одна папка держит всё про юзера:
БД-схему, поля форм, api, ошибки, gateway, клиентский виджет.

## Состав

| Файл | Что |
|---|---|
| `schema.ts` | ТРИ ресурса `lib/db`: `user_auth` (seed обнуляемый, времена + soft delete, блокировки `blocked`, соль подсетей), `user_profile` (никнейм НЕуникальный, кроме запрещённых, адрес аватара), `user_session` (устройство: jti, имя, хэш подсети + история, активность `last_seen_at`, отзыв = soft delete). Миграции — `schemaSpec` в `lib/server/db.ts`; потребление — `db.resource`. И поля формы профиля — из одного объявления |
| `keys.ts` | `@noble/ed25519` (изоморфно, ~3,5 КиБ gzip): `generateKeyPair`, `seedOf`, `sign`, `verify` |
| `types.ts` | клеймы токена, `SessionRecord`, `ProfileView`, `LoginOutcome`, `Blocked` |
| `ports.ts` | порты адаптеров: challenge, sessions, auths, profiles, config, seal, куки, время |
| `auth.ts` | api входа и сессий: `issueChallenge`, `login` (шаги entry/profile/restore), `restoreDeleted` (восстановление удалённого по доказательству), `renew`, `logout`, `logoutAll`, `listSessions`, `revokeSession`, заявка и исполнитель удаления. Фаервол ВНУТРИ api; `guard` — права по access-токену |
| `profile.ts` | профильный api: `profile`/`updateProfile` — отдельно от auth (§6: «откуда у auth profile?») |
| `config.ts` | настройки модуля поверх `#lib/cache`: TTL/поведение — опции приложения; `deleteGraceDays` (дефолт 7) |
| `error.ts` | доменные факты `auth.*`/`profile.*` + `toHttpStatus` (`auth.disabled` → 503) |
| `gateway.ts` | адаптеры портов на `db.resource(user_*)` (SYSTEM-контекст: роли `server`/`admin` — арбитр в api); `AUTH_ENABLED`, seal/unseal, фасад `auth(event)` для экшена, `readVault`/`vaultPayloadOf` |
| `acl.ts` | правила и 21 экран UI ACL (`resolveAcl`): статусы авторизации/сессии/аккаунта (`guest`/`user`/роли, `auth_disabled`, бан, ограничения, удаление) и все отказы моделей `lib/db` (`FailureKind` + `payload_too_large`) |
| `vault.ts` / `vault.svelte.ts` | RAM-vault access (куки HttpOnly клиент не читает) + продление через `kitActionTransport` и лёгкий конверт `ui/seed-form/envelope.ts` |
| `ui/Acl.svelte` | компонент UI ACL пользователя (`allow`, `status`, `blocked`, `restrictions`, `model`): показывает нужный экран вместо содержимого |
| `ui/seed-form/` | самодостаточный модуль формы `seedForm` (`SeedForm.svelte`, `form.ts`, `envelope.ts`, `server.ts`, `index.ts`): срезы `entry` / `register` / `restore` (`authorize = true`, `Acl allow="guest"`) и проверка владения `confirm` (`authorize = false`, без создания сессии и смены токена, доступна и гостю, и авторизованному пользователю) |
| `ui/profile-form/` | самодостаточный модуль формы `profileForm` (`ProfileForm.svelte`, `AvatarTakeover.svelte`, `avatar.ts`, `form.ts`, `server.ts`, `index.ts`): никнейм + бинарное поле `field.photo` с компактным `FileAttachment`/`Attachment` (`showSize={false}`, `showFilename={false}`), удержанием submit через `f.pending` и серверным декодером `decodeWithNode` (`#lib/image/node.js`) без внешнего `base64` |
| `ui/BanNotice.svelte` / `ui/RestrictionsNotice.svelte` | самостоятельные компоненты экранов полной блокировки и ограничений аккаунта |
| `ui/AuthWidget.svelte` | координатор шагов входа (`auth` / `blocked` / `restrictions` / `profile`, адрес — цепочка `?stage=auth.restore`) + куст `formSteps` |
| `ui/MenuBody.svelte` / `ui/MenuModal.svelte` | меню пользователя под `<Acl allow="user">` (ник/аватар, «Изменить профиль» → `?stage=profile`, выход) |
| `index.ts` | единый экспорт модуля |

## Цепочка вызова

```
POST /user/auth (нативный Kit-экшен) ─> execute ─> gateway auth(event)
    ─> core api (ports = db.resource) ─> голый факт {code, path?, args?}

ответ Kit ({type, status, data: devalue}) ─> unwrapKitAction (lib/form/transport)
любая страница: +layout.server.ts ─> readVault(cookies) ─> проп user в vault
```

Ядро (`auth.ts`, `profile.ts`) не знает Request/cookies: голые аргументы → голый
факт; куки и HTTP-перевод — gateway.

## Выключение и env (конвенция хода 256)

`AUTH_SEAL_SECRET` не задан → вход выключен, 500 не бывает: страница `/user/auth`
показывает баннер «Вход выключен», `readVault` возвращает `null`, execute
отклоняет все интенты, кроме `logout`, фактом `auth.disabled` (503). Неверное
значение (секрет < 32 байт) → падение старта с именем переменной.

## Токены и отзыв (модель владельца)

- `auth_tmp` (access, 15 мин) + `auth_sid` (продление, год) — HttpOnly-куки;
  access дублируется в RAM-vault для заголовков. Продление сверяет версию куки
  (`session.version`): не совпала — «усыновление» свежей.
- Снимок профиля (ник/аватар) запечатан в access-токен при чеканке:
  сохранение профиля перевыпускает токены (`renew` в экшене роута) и
  возвращает свежий снимок в ответе для vault — иначе шапка и меню
  показывали бы профиль на момент входа до следующего продления.
- Блэклиста access нет: украденный access умирает на exp (цена признана гайдом);
  отзыв сессии/блокировка — на точке продления (`renew`).
- Софт-удаление: сессия = отзыв; аккаунт = заявка — обычный поиск
  удалённую строку не видит (политика модели), вход получает факт
  `auth.deleted` БЕЗ сессии; восстановление — отдельное подтверждение
  `restoreDeleted`: подпись по seed проверяется ДО привилегированного
  поиска удалённой строки, затем `restore` модели и обычный вход.
  Срок не проверяется: восстановимость ≡ seed ещё существует.
  Окончательно — исполнитель `sweepDeletions` по грейсу: профиль
  уходит, seed стирается, строка-надгробие остаётся (вызывающего
  планировщика в приложении пока нет).

## Кто генерирует seed при регистрации (решение владельца, ревизия хода 261)

С JS — **браузер**: клик «Создать аккаунт» перехватывается, `generateKeyPair()`
делается локально (`keys.ts` изоморфен по плану `auth-seed.md` §1), ключ не
покидает устройство, серверного запроса на смену шага нет вообще (шаг меняет
хост шагов локально, адрес — своим ключом брони, load не вызывается).

Серверная генерация в load (`registerSeed`) — **fallback** без JS, обновления
страницы и deep-link: страница пришла с сервера, seed виден в HTML — в этом
пути виджет показывает блок «Seed создал и подписал сервер» с предупреждением.
В JS-пути блок другой: «Seed сгенерирован в этом браузере». Различение — по
тому, есть ли локальный ключ (`localSeed`), а не по устройству пользователя.

Общий принцип (см. `lib/components/steps/README.md`): менять компоненты/шаги
без участия сервера — локальными переменными состояния и `set()` хоста;
серверные данные (`load`) — только начальное состояние и fallback без JS.

## Приватность

IP не храним: хэш подсети с солью аккаунта + страна; история — только хэши.
Активность — `user_session.last_seen_at` (не колонка auth). Профиль — ровно
никнейм и адрес аватара. Ни email, ни имени, ни аналитических кук.
