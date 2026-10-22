# Реестр на тестирование: найденные баги, дыры и хвосты старого кода

Составлен по результатам статической сверки исходного кода на ветке `img` (базовый коммит `55bdb7f`) **без запуска тестовых раннеров** по прямому указанию владельца.

Все пункты ниже подтверждены чтением исходников и разбиты на четыре группы по приоритету:
- **P0 — Критичные баги и безопасность** (`TB-01` .. `TB-05`);
- **P1 — Функциональные баги пользовательских сценариев** (`TB-06` .. `TB-09`);
- **P2 — Хвосты старого кода и архитектурные нестыковки** (`TB-10` .. `TB-14`);
- **P3 — Контрольный прогон правок, внесённых без запуска тестов** (`TB-15`).

---

## Сводная таблица

| ID | Приоритет | Вид | Файлы | Краткая суть |
|---|---|---|---|---|
| `TB-01` | **P0** | bug / cookie | `src/content/user/auth.ts`, `src/content/user/ui/profile-form/server.ts` | `data:image/jpeg;base64,…` аватара упаковывается внутрь куки `auth_tmp` → превышение 4 КБ (RFC 6265) / `431` на реальных фото |
| `TB-02` | **P0** | bug | `src/content/user/ui/AuthWidget.svelte`, `src/content/user/ui/seed-form/SeedForm.svelte`, `src/content/user/auth.ts` | Одноразовый `nonce` сгорает при неверном `seed`, а `refreshChallenge()` не вызывается → вторая попытка падает с `auth.nonce-unknown` |
| `TB-03` | **P0** | security / bug | `src/content/user/gateway.ts` | `readVault()` на SSR не проверяет `exp`, отзыв сессии, бан и `deletedAt` (`Iron.unseal` держит окно в 1 год) |
| `TB-04` | **P0** | security | `src/content/user/gateway.ts` | `challenge.consume()` неатомарен (`get` + `delete`, гонка replay) и живёт в `localStore` вместо `sharedStore` |
| `TB-05` | **P0** | security | `src/content/user/gateway.ts` | `logout()` при истёкшей `auth_tmp` не отзывает сессию в БД по `auth_sid`; куки жёстко имеют `secure: false` |
| `TB-06` | **P1** | bug | `src/hooks/component-form/server.ts`, `src/hooks/component-form/client.svelte.ts` | При `raw === 'too-large'` выбирается первая форма реестра (`user-seed`), теряя ошибку `413` у `ProfileForm` без JS и раздувая буфер `SeedForm` до 10.25 МБ |
| `TB-07` | **P1** | bug | `src/hooks/component-form/client.svelte.ts` | `target` URL в `bindComponentForm` замораживается при первом рендере (`untrack`) и не следует за сменой query/слоя |
| `TB-08` | **P1** | bug | `src/content/user/ui/profile-form/{ProfileForm.svelte,AvatarTakeover.svelte}` | Скрытый флаг `remove_avatar` не сбрасывается и не имеет UI-отмены после клика «Удалить текущее фото» |
| `TB-09` | **P1** | bug | `src/content/user/ui/AuthWidget.svelte`, `src/content/user/ui/profile-form/ProfileForm.svelte` | Устаревший SSR `data.user.prof` имеет приоритет над свежим `vault.profile` у `existingAvatar` |
| `TB-10` | **P2** | legacy-tail | `src/routes/(site)/(app)/fields/{forms.ts,handle.ts}` | Ручные `sniff()` и `base64()` без проверки размеров/пикселей (пропускают декомпрессионную PNG-бомбу < 1 МБ) |
| `TB-11` | **P2** | legacy-tail | `src/content/user/ui/profile-form/server.ts`, `src/content/user/{profile.ts,config.ts,checks.ts}` | Рассинхрон `SERVER_PHOTO_FORMATS` и `config.avatarFormats` между входом конвейера и проверкой записи |
| `TB-12` | **P2** | legacy-tail | `src/content/user/ui/profile-form/server.ts`, `src/content/user/profile.ts` | Очистка поля `nickname` не удаляет старый никнейм (пустая строка тихо игнорируется) |
| `TB-13` | **P2** | bug / kit | `src/hooks/component-form/server.ts` | Spread `{ ...event, request }` в `renderInlineWithResult` теряет прототип `RequestEvent` |
| `TB-14` | **P2** | legacy-tail | `src/content/user/{auth.ts,gateway.ts}` | `sweepDeletions()` нигде не подключён к планировщику; устаревший комментарий в шапке `gateway.ts` про RAM-адаптеры |
| `TB-15` | **P3** | verification | весь репозиторий | Полный прогон `npm test`, `npm run check`, `npm run build` и 12 браузерных сценариев Playwright |

---

## Детальное описание и сценарии проверки

### `TB-01` [P0 · bug / cookie] Переполнение `Set-Cookie` (`auth_tmp`) на реальных фотографиях аватара
- **Где:** `src/content/user/ui/profile-form/server.ts:66`, `src/content/user/auth.ts:249-260`, `src/content/user/gateway.ts:392-395`.
- **Корневая причина:** `prepareAvatar` возвращает `data:image/jpeg;base64,…` (при `avatarMaxBytes` по умолчанию до десятков КБ), `updateProfile` записывает эту строку в `user_profile.avatar_url`, а `freshAccess()` упаковывает `prof: { nickname, avatarUrl }` целиком внутрь запечатанного Iron-токена куки `auth_tmp`. Синтетический однотонный JPEG в `test/browser/auth.mjs` весит ~700 байт (< 4096 B) и маскирует дефект.
- **Проявление:** На реальной цветной фотографии 256×256 (сжатый JPEG 12–30 КБ → `dataUrl` 16–40 КБ) заголовок `Set-Cookie: auth_tmp=…` превышает лимит браузера `4096 B` на куку (RFC 6265) — Chromium отбрасывает куку, а HTTP-клиенты с длинным `Cookie` получают `431 Request Header Fields Too Large`.
- **Тест на воспроизведение:** Загрузить через `ProfileForm` шумное RGB-изображение 512×512 (сжатый JPEG ≥ 8 КБ), перезагрузить страницу и проверить, что `document` на SSR сохранил авторизацию и аватар (`status === 200`, `auth_tmp` < 4096 B).

---

### `TB-02` [P0 · bug] Вечная ошибка `auth.nonce-unknown` со второй попытки ввода `seed` с JS
- **Где:** `src/content/user/auth.ts:93-98`, `src/content/user/ui/seed-form/server.ts:52-63`, `src/content/user/ui/AuthWidget.svelte:144-160`, `src/content/user/ui/seed-form/SeedForm.svelte:98-156`.
- **Корневая причина:**
  1. `proveSeed()` вызывает `await ports.challenge.consume(args.nonce)` **до** проверки подписи `ports.crypto.verify(...)`, сжигая одноразовый `nonce`.
  2. При неверном `seed` сервер вызывает `fail(instruction({ code: 'auth.signature', path: 'signature' }))` — в `Result` **нет** поля `data.step`.
  3. В `AuthWidget.svelte:148` эффект делает `const next = stepOf(state.result); if (!next) return`, из-за чего `refreshChallenge()` не вызывается!
  4. В автономном `<SeedForm />` (`SeedForm.svelte`) механизма `refreshChallenge()` нет вовсе, а в `AuthWidget.svelte:163` `challengeTransport` жёстко привязан к `'/user/auth'`.
- **Проявление:** Пользователь ошибается в одном символе `seed` → получает `auth.signature` → исправляет `seed` на верный → нажимает кнопку повторно и навсегда застревает на `auth.nonce-unknown` до перезагрузки страницы.
- **Тест на воспроизведение:** В браузере с JS отправить заведомо неверный 43-символьный `seed` (как в `AuthWidget`, так и в автономном `<SeedForm authorize={false} />`), затем сразу ввести валидный `seed` и проверить успешный вход / `onConfirmed` без перезагрузки страницы.

---

### `TB-03` [P0 · security / bug] `readVault()` на SSR пропускает истёкшие, отозванные и забаненные сессии
- **Где:** `src/content/user/gateway.ts:300-303, 444-461`, `src/routes/(site)/+layout.server.ts:12`.
- **Корневая причина:** `Iron.unseal` в `gateway.ts:302` вызывается с фиксированным потолком `ttl: 365 * 24 * 3600 * 1000` (1 год), а `readVault(cookies)` лишь распечатывает `auth_tmp` и **не вызывает `guard()`**: не проверяет ни `payload.exp <= Date.now()`, ни отзыв сессии в `user_session`, ни `auth.blocked`, ни `auth.deletedAt`.
- **Проявление:** После отзыва сессии с другого устройства, бана аккаунта или истечения `payload.exp` (пока браузер ещё хранит куку или клиент прислал её заголовок) SSR рендерит страницу как авторизованную: `<Acl allow="user">` открывает закрытый контент, `UserMenu` показывает вход.
- **Тест на воспроизведение:** Войти на устройстве A, отозвать его сессию через `revokeSession` / `logoutAll` (или пометить аккаунт `blocked`), выполнить `GET` с прежней `Cookie: auth_tmp=…` и проверить, что SSR возвращает гостевое состояние (`data.user === null`).

---

### `TB-04` [P0 · security] Неатомарный `challenge.consume()` и хранение `nonce` в `localStore`
- **Где:** `src/content/user/gateway.ts:273-286`.
- **Корневая причина:**
  1. `consume` делает два отдельных асинхронных шага: `const had = await store.get(k); await store.delete(k)` — между `await` два параллельных запроса с одной подписью оба получают `had === true` (replay-гонка).
  2. `challenge` и `user-config` в `gateway.ts` используют `localStore` (память одного процесса) вместо `sharedStore` (`cache_kv` в БД). На multi-worker / serverless-деплое `GET` и `POST` попадают на разные воркеры и дают ложный `auth.nonce-unknown`.
- **Тест на воспроизведение:** Запустить `Promise.all([u.login(sameProof), u.login(sameProof)])` на один `nonce` — ровно один вызов обязан вернуть `{ ok: true }`, второй обязан получить `auth.nonce-unknown`.

---

### `TB-05` [P0 · security] Неполный `logout()` при истёкшей `auth_tmp` и зашитый `secure: false` у кук
- **Где:** `src/content/user/gateway.ts:43, 415-423`.
- **Корневая причина:**
  1. `logout()` передаёт в `coreLogout(ports, access())` только `auth_tmp`. Если `auth_tmp` (короткий TTL) уже истекла, а `auth_sid` (`RENEWAL_COOKIE`, длинный TTL) жива, `guard()` возвращает `auth.expired`, и запись в таблице `user_session` **не помечается удалённой** (`deleted_at` остаётся `NULL`) — сохранённый злоумышленником `auth_sid` продолжает выпускать новые `access` через `renew()`.
  2. `COOKIE_BASE` содержит жёсткий `secure: false` вместо вывода флага по протоколу запроса (`new URL(event.request.url).protocol === 'https:'`).
- **Тест на воспроизведение:** Войти, удалить куку `auth_tmp`, оставив только `auth_sid`, вызвать `POST` с `intent=logout`, затем попытаться вызвать `renew()` со старым `auth_sid` — должен вернуться `auth.revoked` (`401`).

---

### `TB-06` [P1 · bug] `componentFormsHandle`: чужой `formId` при `413` и буферизация до `10.25 МБ` для маленьких форм
- **Где:** `src/hooks/component-form/server.ts:40-47, 121-133`, `src/hooks/component-form/client.svelte.ts:24-30`.
- **Корневая причина:**
  1. `peekFormDataBounded` читает тело до `maxRegisteredBytes()` — максимума по **всем** зарегистрированным формам (`profileForm`: `10 МБ + 256 КБ`), поэтому POST на лёгкую `seedForm` буферизует до 10.25 МБ в RAM прежде чем `bodyLayer` вернёт `413`.
  2. При превышении потолка (`raw === 'too-large'`) выбирается `registry.values().next().value` (первая форма реестра — `seedForm`), из-за чего `result.formId === 'user-seed'`. На `ProfileForm` без JS `readPageFormResult('user-profile')` отбрасывает чужой `formId`, и ошибка `413` пропадает с экрана.
- **Тест на воспроизведение:** Отправить без JS в `ProfileForm` файл размером `11 МБ` и проверить, что на странице отображается ошибка `body.too-large` со статусом `413`.

---

### `TB-07` [P1 · bug] Замороженный `target` URL в `bindComponentForm` при клиентских переходах
- **Где:** `src/hooks/component-form/client.svelte.ts:38-45`.
- **Корневая причина:** `const target = untrack(() => action ?? readCurrentHref())` вычисляет адрес один раз при создании связки. При последующей смене query-строки в той же вкладке (`?stage=…`, `?next=…`, открытие/закрытие модалки) `action` и `kitActionTransport(target)` продолжают бить в старый URL.
- **Тест на воспроизведение:** Открыть `/user/auth`, переключить шаг в `hybrid`-режиме или открыть `user.auth` поверх страницы с изменённым query и проверить URL уходящего `POST`.

---

### `TB-08` [P1 · bug] Необратимый скрытый флаг `remove_avatar` в `ProfileForm`
- **Где:** `src/content/user/ui/profile-form/ProfileForm.svelte:86-93, 128-136`, `AvatarTakeover.svelte:53-105, 134-156`.
- **Корневая причина:** Клик по крестику «Удалить текущее фото» выставляет `bound.f.remove_avatar.onInput(true)` и скрывает превью текущего аватара. Скрытый чекбокс `remove_avatar` с JS спрятан в `<div hidden>`: у пользователя нет ни плашки «Текущее фото будет удалено», ни кнопки «Отменить удаление», а отмена выбора нового файла / ошибка `prepareAvatar` оставляет `remove_avatar === true`.
- **Тест на воспроизведение:** Нажать «Удалить текущее фото» → проверить наличие явной возможности отменить удаление до нажатия «Сохранить» и сброс `remove_avatar` при выборе нового валидного файла.

---

### `TB-09` [P1 · bug] Приоритет устаревшего SSR `initial` над живым `vault.profile` в `ProfileForm`
- **Где:** `src/content/user/ui/AuthWidget.svelte:208-215`, `src/content/user/ui/profile-form/ProfileForm.svelte:79-85`.
- **Корневая причина:** `existingAvatar` вычисляется как `initial?.avatarUrl ?? vault.profile.avatarUrl`. Если SSR-снимок `data.user` содержал прежний `avatarUrl` (до клиентского обновления/перевхода без перезагрузки `load`), устаревший `initial.avatarUrl` перекрывает актуальный `vault.profile.avatarUrl` (в том числе `null` после удаления фото!).
- **Тест на воспроизведение:** Сохранить аватар → удалить аватар с JS → повторно открыть `ProfileForm` без полной перезагрузки и убедиться, что старое фото не появляется снова из `data.user`.

---

### `TB-10` [P2 · legacy-tail] Ручные `sniff()` / `base64()` и пропуск декомпрессионных бомб на `/fields`
- **Где:** `src/routes/(site)/(app)/fields/{forms.ts,handle.ts}`.
- **Корневая причина:** Демо `/fields` не переведено на `#lib/components/form/photo.js` и `#lib/image/probe.js` (этап R5 в [`docs/design/image-transfer.md`](../design/image-transfer.md)). Функция `sniff()` проверяет только первые 4–12 байт сигнатуры без чтения `width × height`.
- **Тест на воспроизведение:** Сгенерировать валидный PNG 20000×20000 из нулей (~40 КБ < `1 МБ`), отправить в форму записи `/fields` и убедиться после миграции на `photo.ts`, что срабатывает `image.dimensions` до рендера `<img>`.

---

### `TB-11` [P2 · legacy-tail] Рассинхрон `SERVER_PHOTO_FORMATS` и динамического `config.avatarFormats`
- **Где:** `src/content/user/checks.ts`, `src/content/user/ui/profile-form/server.ts:16, 56`, `src/content/user/profile.ts:87-93`.
- **Корневая причина:** `profile-form` проверяет входные файлы по константе `SERVER_PHOTO_FORMATS` и всегда кодирует выход в `image/jpeg`, тогда как `profile.ts:checkAvatar` сверяет выходной `dataUrl` с `ports.config.get('avatarFormats')`. Изменение `avatarFormats` в конфиге ломает сохранение или игнорируется на входе.
- **Тест на воспроизведение:** Задать кастомный `avatarFormats` в `userConfig` и проверить сквозное сохранение через `ProfileForm`.

---

### `TB-12` [P2 · legacy-tail] Невозможность очистить сохранённый `nickname` в профиле
- **Где:** `src/content/user/ui/profile-form/server.ts:46, 69-72`, `src/content/user/profile.ts:39-48`.
- **Корневая причина:** Пустая строка `nickname` отфильтровывается выражением `...(nickname ? { nickname } : {})`, поэтому стирание поля в `ProfileForm` молча оставляет прежний ник в БД; а `updateProfile({ nickname: undefined })` не отличает «не менять» от «сбросить в `null`».
- **Тест на воспроизведение:** Сохранить ник `'Tester'`, очистить поле `nickname`, отправить форму и проверить, что ник стал `null` («Без никнейма»).

---

### `TB-13` [P2 · bug / kit] Потеря прототипа `RequestEvent` при `{ ...event, request }` в `renderInlineWithResult`
- **Где:** `src/hooks/component-form/server.ts:112-119`.
- **Корневая причина:** Поверхностный spread `{ ...event, request }` копирует только собственные перечисляемые свойства `event`. Если адаптер SvelteKit держит свойства/геттеры на прототипе `event`, inline-рендер ошибки `no-JS` потеряет их.
- **Тест на воспроизведение:** Проверить `no-JS` POST с ошибкой `422` на `vite preview` и в связке с чтением всех полей `RequestEvent` внутри `load`.

---

### `TB-14` [P2 · legacy-tail] Неподключённый исполнитель `sweepDeletions()` и устаревшая шапка `gateway.ts`
- **Где:** `src/content/user/auth.ts:419-428`, `src/content/user/gateway.ts:11-15`.
- **Корневая причина:** `sweepDeletions(ports)` реализован, но нигде в сервере приложения не вызывается (просроченные удалённые аккаунты не зачищают `profile` и `seed` после истечения `deleteGraceDays`). В комментарии `gateway.ts:11-15` осталось старое утверждение про хранение сессий/профилей в RAM-кэше, хотя ниже уже работают адаптеры таблиц `#lib/db`.
- **Тест на воспроизведение:** Интеграционный тест cron/endpoint'а или фонового sweep-триггера с прокруткой `clock` за `deleteGraceDays`.

---

### `TB-15` [P3 · verification] Контрольный прогон всех тестовых наборов после чистки и рефакторинга папок
- **Контекст:** В текущем ходе по требованию владельца не запускался ни один тест/тайпчек/сборщик. При следующем включении тестирования выполнить полный контур:
  1. `npm run check` (`svelte-kit sync && svelte-check` — 0 ошибок и 0 предупреждений);
  2. `npm test` (`vitest run` со всеми юнит-тестами, включая `src/lib/db/test/db-docs.test.ts`, + `node --test tooling/*.test.mjs`, `tooling/core-purity.mjs`, `tooling/classes-audit.mjs`, `tooling/ark-owns.mjs`, `tooling/form-size.mjs`, `tooling/size-budget.mjs`);
  3. `npm run build` (проверка `layer-guard` и production-бандла);
  4. `npm run test:browser` на `vite preview` (все 11 E2E-наборов, включая `auth.mjs`) + `ATTACHMENT_BASE="http://127.0.0.1:5179/fields" node test/browser/attachment.mjs` на `vite dev`.
