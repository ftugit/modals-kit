# Жизненный цикл сессии, токенов и единого `vault`

Аудит механизма авторизации, хранения токенов, межвкладочной синхронизации и гонок в `src/content/user/**`, `src/hooks/component-form/**` и маршрутах `src/routes/(site)/**`.

Документ фиксирует:
1. Переход к **единому реактивному API `vault`** с инкапсуляцией состояния в замыкании (полный отказ от `readUser(server)`, пропов `server` и дублирующих SSR-вызовов `readVault` на страницах).
2. **Полную карту всех узлов кодовой базы, которые манипулируют авторизацией** (создают, продлевают, обновляют или отзывают токены, куки, строки БД и RAM-состояние).
3. **Пошаговую верификацию 6 пунктов целевой модели сессии**, расхождения с текущим кодом, найденные уязвимости/гонки и архитектурные развилки.

---

## 1. Единый API `vault` (отказ от `readUser(server)` и пропа `server`)

### Текущая проблема
В компонентах пользовательского контура параллельно сосуществуют два механизма чтения состояния:
- серверный снимок `data.user`, вручную прокидываемый через пропы `server={data.user}` / `data.user` и хелпер `readUser(server)` (`UserMenu.svelte`, `MenuBody.svelte`, `AuthWidget.svelte`, `ProfileForm.svelte`, `Acl.svelte`, `SeedForm.svelte`);
- дублирующие вызовы `readVault(event.cookies)` в `src/routes/(site)/(app)/user/auth/+page.server.ts` и `src/routes/(site)/(app)/user/menu/+page.server.ts`, хотя корневой `src/routes/(site)/+layout.server.ts` уже формирует `data.user` для всего дерева маршрутов.

### Целевая схема
Состояние `vault` создаётся **фабрикой на замыкании** (`createVault()`), чтобы приватные данные (токен, сроки `expiresAt` / `ttlMs`, таймер, счётчик поколений `epoch`, канал синхронизации) находились в лексическом скоупе замыкания и были недоступны для внешней мутации или сериализации:

- Снаружи экспортируется **только один реактивный объект `vault`** с read-only геттерами и методами жизненного цикла:
  - `vault.authorized: boolean`
  - `vault.principal: string | null`
  - `vault.profile: VaultProfile` (`{ nickname, avatarUrl }`)
  - `vault.renewing: boolean`
  - методы управления: `vault.syncServer(payload)`, `vault.hydrate(payload)`, `vault.clear()`, `vault.renew()`, `vault.ensureFresh()`
- **Бесшовный SSR и гидратация без `readUser`:** внутри геттеров `authorized` / `principal` / `profile` до первой клиентской синхронизации вкладки (`typeof window === 'undefined' || !synced`) `vault` сам читает `(page.data as { user?: VaultPayload | null }).user ?? null`, а после инициализации — исключительно приватные `$state`-переменные замыкания.
- **Следствия для компонентов и роутов:**
  - функция `readUser`, тип `ServerUserSnapshot` и реэкспорт `hydrateVault` удаляются;
  - проп `server` удаляется из `UserMenu.svelte`, `MenuBody.svelte` и их вызовов в `+layout.svelte` и `/user/menu/+page.svelte`;
  - дублирующие `readVault(event.cookies)` убираются из `/user/auth/+page.server.ts` и `/user/menu/+page.server.ts` (остаётся единственная точка чтения сессии в корневом `+layout.server.ts`);
  - в `Acl.svelte` и `SeedForm.svelte` остаётся только опциональный булев override `authorized?: boolean` (для демо-витрин `/user` и изолированных тестов), а по умолчанию оба читают `vault.authorized`.

---

## 2. Полная карта манипуляторов состояния авторизации

Ниже перечислены **все без исключения точки в кодовой базе**, которые создают, изменяют, продлевают или уничтожают состояние авторизации (в БД `user_session`, в `HttpOnly`-куках `auth_sid` / `auth_tmp` или в клиентском RAM `vault`).

### 2.1. Серверные манипуляторы (БД + `HttpOnly`-куки)

| № | Файл и узел | Операции | Что меняет в БД (`user_session` / `user_auth`) | Что делает с куками (`auth_sid`, `auth_tmp`) |
|---|---|---|---|---|
| S1 | `src/content/user/gateway.ts` (`auth(event)`) | `login`, `restoreDeleted` | Создаёт строку `user_session` (`version: 0`); при `restoreDeleted` снимает `deleted_at` в `user_auth` | Ставит обе `HttpOnly`-куки: `auth_sid` (`maxAge: deviceTtlSec`) и `auth_tmp` (`maxAge: accessTtlSec`) |
| S2 | `src/content/user/gateway.ts` (`auth(event).renew`) | `renew` | При `token.version === session.version` увеличивает `version + 1` и `last_seen_at`; при `token.version < session.version` («усыновление») БД не меняет | При ротации ставит новые `auth_sid` + `auth_tmp`; при «усыновлении» — **только** новый `auth_tmp` |
| S3 | `src/content/user/gateway.ts` (`logout`, `logoutAll`, `revokeSession`, `requestDelete`) | Завершение сессий и удаление аккаунта | `softDelete` по `jti` / `softDeleteAllByAuth` / `markDeleted` | `logout` и `logoutAll` вызывают `clearCookies()`; **`requestDelete()` сейчас ни сессии не отзывает, ни куки не чистит** |
| S4 | `src/content/user/ui/seed-form/server.ts` + `src/hooks/component-form/server.ts` | POST-интенты `login`, `restore`, `logout`, `renew` | Вызывает `S1`–`S3` | Пробрасывает собранные в `trackedCookies` заголовки `Set-Cookie` в JSON/HTML-ответ и возвращает `{ user }` для RAM |
| S5 | `src/content/user/ui/profile-form/server.ts` | POST сохранения профиля (`nickname`, `avatar`) | Обновляет `user_profile` + **вызывает `u.renew()`** (`version + 1` в `user_session`) | Перевыпускает куки с обновлённым `prof` внутри `auth_tmp` и возвращает `{ user }` в JSON |
| S6 | `src/routes/(site)/+layout.server.ts` (`readVault`) | SSR `load` при открытии страницы / вкладки | Сейчас ничего не пишет | Сейчас читает **только** `auth_tmp` (`ACCESS_COOKIE`); `auth_sid` при истёкшем `auth_tmp` игнорируется |

### 2.2. Клиентские манипуляторы (RAM `vault`)

| № | Файл и узел | Триггер | Действие над `vault` |
|---|---|---|---|
| C1 | `src/routes/(site)/+layout.svelte` (`$effect.pre`) | Первичная гидратация вкладки и смена `data.user` после навигации | `vault.syncServer(data.user)` |
| C2 | `src/content/user/ui/AuthWidget.svelte` (`$effect`) | Успешный ответ `seedForm` (`login` / `register` / `restore`) с полем `next.user` | `vault.hydrate(next.user)` |
| C3 | `src/content/user/ui/profile-form/ProfileForm.svelte` (`$effect`) | Успешный ответ `profileForm` с полем `payload.user` | `vault.hydrate(payload.user)` |
| C4 | `src/content/user/ui/MenuBody.svelte` (`$effect`) | Ответ `seedForm` (`intent="logout"`) с `data.step === 'entry'` | `vault.clear()` |
| C5 | `src/content/user/vault.svelte.ts` (`schedule` → `renew` → `postRenew`) | Фоновый `setTimeout` в окне `leadFor(ttlMs)` перед `expiresAt` | Отправляет `POST /user/auth?/renew` (`intent="renew"`) и вызывает `vault.hydrate(...)` |

### 2.3. Чистые читатели (не модифицируют состояние)
- `src/content/user/ui/UserMenu.svelte` — переключатель шапки («Авторизация» / аватар).
- `src/content/user/ui/Acl.svelte` — шлюз доступа (`allow="guest" | "user"`).
- `src/content/user/ui/seed-form/SeedForm.svelte` — делегирует в `<Acl allow="guest">` при `authorize={true}`.
- `src/content/user/ui/BanNotice.svelte`, `RestrictionsNotice.svelte` — делегируют в `<Acl>`.

---

## 3. Проверка 6 пунктов жизненного цикла и найденные баги / гонки

### Пункт 1. Вход: куки + закрытое хранилище в RAM
> Ожидание: при входе оба токена записываются в куки; при JS-входе JS хватает токены в закрытое замыкание в RAM, недоступное извне.

- **Поправка по модели безопасности (важно):**
  - В куки действительно пишутся **оба** токена с флагом `HttpOnly` (`auth_sid` — сессия устройства на 30 дней, `auth_tmp` — короткий токен с профилем).
  - В закрытое замыкание JS (`createVault()`) должен попадать **только снимок короткого токена / метаданные срока (`expiresAt`, `ttlMs`, `sub`, `prof`)**, а **долгоживущий `auth_sid` (`renewal`) никогда не должен сериализоваться в JSON и попадать в RAM браузера**.
  - **Причина:** лексическое замыкание в JS надёжно защищает от случайного чтения из прикладного кода и `window`, но **не защищает от XSS в том же origin** — вредоносный скрипт перехватывает `window.fetch` / `Response.prototype.json` до вызова callback'а. Пока `auth_sid` живёт исключительно в `HttpOnly`-куке, даже при кратковременном XSS атакующий не может выкрасть 30-дневный токен устройства, а браузер сам прикладывает `auth_sid` к `POST` на наш origin.

---

### Пункт 2. Выход: удаление кук и мгновенная очистка RAM без перезагрузки
> Ожидание: куки удаляются на сервере, JS перехватывает ответ без перезагрузки и чистит RAM.

В текущем коде обнаружены **два бага безопасности и две гонки**:
1. **[БАГ БЕЗОПАСНОСТИ — `auth.ts:363`, `gateway.ts:401`]: Выход с истёкшим `auth_tmp` не закрывает сессию в БД.**
   Сейчас `u.logout()` вызывает `coreLogout(ports, access())`, проверяя **только** короткоживущую куку `auth_tmp` (`ACCESS_COOKIE`). Если вкладка простояла дольше `accessTtlSec` (например, 20 минут при живом 30-дневном `auth_sid`) и пользователь нажал «Выйти»:
   - `coreLogout` возвращает `{ ok: false, fact: { code: 'auth.expired' } }` и **не вызывает `sessions.softDelete(jti)`**;
   - `clearCookies()` стирает куки в браузере, но строка в таблице `user_session` остаётся **активной в БД на все оставшиеся 30 дней**.
   - Аналогичная проблема в `logoutAll()` (требует живой `auth_tmp`) и в `requestDelete()` (помечает аккаунт на удаление, но не отзывает сессии и не чистит куки).
   - **Исправление:** `logout` / `logoutAll` обязаны извлекать субъект/сессию из `auth_tmp`, а если `auth_tmp` отсутствует или просрочен — распечатывать `auth_sid` (`RENEWAL_COOKIE`) и отзывать сессию в БД по нему; `requestDelete` обязан завершать сессии и очищать куки.
2. **[БАГ МЕЖВКЛАДОЧНОСТИ — `vault.svelte.ts:60`]:** `vault.clear()` очищает RAM только в активной вкладке; соседние открытые вкладки остаются «авторизованными» в RAM.
3. **[ГОНКА `renew` ↔ `logout` — `vault.svelte.ts:119-145`]:** если фоновый `POST /user/auth?/renew` ушёл за 50 мс до клика «Выйти» и вернулся после `vault.clear()`, `postRenew()` вызывает `this.hydrate(...)` и **повторно авторизует интерфейс после выхода**.
   - **Исправление:** монотонный счётчик `epoch` и `AbortController` в замыкании `vault`. Любой `clear()` или новый `hydrate()` инкрементирует `epoch` и отменяет полёт старого `renew`.

---

### Пункт 3. Продление: обновление кук и RAM
> Ожидание: при продлении обновляется пара в куках, а при JS-запросе обновляется и RAM.

- **Нюанс ротации в `auth.ts:326-354`:** при штатной ротации (`token.version === session.version`) обновляются **обе** куки (`auth_sid` с `version + 1` и новый `auth_tmp`); при догоняющем запросе соседней вкладки (`token.version < session.version`) обновляется только `auth_tmp` (свежий `auth_sid` сохраняется).
- **[ГОНКА `profileForm` ↔ фоновый `renew`]:** `profile-form/server.ts:79` тоже вызывает `u.renew()`, чтобы запечь новый ник/аватар в `auth_tmp`. Если параллельно летел фоновый `vault.renew()`, его запоздавший ответ со старым `prof` перезапишет только что сохранённый ник/аватар в RAM. Защита через `epoch` (или сравнение `expiresAt` / отмена текущего `renew` при старте мутации) устраняет гонку.

---

### Пункт 4. Открытие новой вкладки: инициализация RAM из кук
> Ожидание: при открытии новой вкладки она забирает токены из кук в хранилище.

- Поскольку куки `HttpOnly`, новая вкладка получает начальный снимок через SSR (`+layout.server.ts` → `data.user` → `vault`).
- **[КРИТИЧЕСКИЙ БАГ — `+layout.server.ts:12` + `gateway.ts:415` (`readVault`)]: Новая вкладка разлогинивает пользователя сразу после истечения короткого `auth_tmp`!**
  Сейчас `readVault(cookies)` проверяет **только** `cookies.get(ACCESS_COOKIE)`. Когда пользователь возвращается на сайт или открывает новую вкладку спустя `> accessTtlSec` (например, через час или на следующий день при живом 30-дневном `auth_sid`):
  - `auth_tmp` уже удалён браузером по `maxAge`;
  - `readVault` возвращает `null` — **новая вкладка открывается в состоянии гостя при живой сессии `auth_sid`!**
- **Исправление:** заменить пассивный `readVault(cookies)` в `+layout.server.ts` на `resolveSession(event)`:
  1. Если `auth_tmp` валиден (`exp > now`) — вернуть снимок мгновенно без похода в БД (`0` запросов к БД).
  2. Если `auth_tmp` отсутствует или истёк, **но присутствует `auth_sid`** — выполнить `auth(event).renew()` прямо в SSR `load` (SvelteKit штатно выставляет `Set-Cookie` в ответ HTML-документа и сразу отдаёт свежий `data.user` в первый кадр рендера; если же `auth_sid` отозван/истёк — `clearCookies()` сразу удаляет мёртвую куку).

---

### Пункт 5. Защита от гонки обновления между несколькими вкладками
> Вопрос владельца: решается ли гонка отметкой времени в куках и случайным смещением в 5%?

#### Что уже реализовано в коде и где в нём дефект
1. **Случайное смещение (джиттер) 5% уже реализовано** в `src/content/user/vault.ts:13-22` (`fireAt` выбирает случайную точку внутри `lead = max(5% TTL, 60 с)`).
2. **Межвкладочный замок `navigator.locks` уже подключён** в `vault.svelte.ts:104` (`navigator.locks.request('modals-kit:user:renew', ...)` координирует очередь между всеми вкладками одного origin).
3. **[БАГ В `vault.svelte.ts:106`]: Вторая вкладка под замком всё равно шлёт дублирующий сетевой запрос!**
   После того как вкладка №1 обновила куки под `navigator.locks`, очередь переходит ко вкладке №2, которая проверяет `this.expiresAt` **в своей локальной RAM**. Так как вкладка №1 не сообщила вкладке №2 новый `expiresAt`, вкладка №2 видит старый срок в своей памяти и стреляет вторым `POST /user/auth?/renew`. Вдобавок формула `this.expiresAt - leadFor(this.ttlMs) + leadFor(this.ttlMs) * 0.5` на строке `106` ошибочно подавляет половину джиттер-окна даже для первой вкладки!
4. **[ГОНКА НА СЕРВЕРЕ — `auth.ts:316-349`]: Неатомарное чтение-запись версии сессии.**
   Два одновременных запроса без замка (например, параллельное открытие двух SSR-вкладок) оба читают `session.version === N` до того, как первый успевает сохранить `N + 1`, и оба перезаписывают строку `version: N + 1`.

#### Почему связка `navigator.locks` + `BroadcastChannel` + singleflight лучше куки с timestamp
- Отдельная не-`HttpOnly` кука с timestamp добавляет лишний заголовок `Cookie` к каждому HTTP-запросу статики/API и не умеет мгновенно будить соседние вкладки при `logout`, `login` или смене аватара/ника.
- Нативный **`BroadcastChannel('modals-kit:user')` + `navigator.locks('modals-kit:user:renew')`**:
  1. Вкладка №1 захватывает замок, делает **ровно 1** сетевой `POST`, обновляет свою RAM и публикует `{ type: 'hydrate', payload }` в `BroadcastChannel`.
  2. Все остальные вкладки мгновенно получают свежий `payload` (и новый `expiresAt`, и свежий `prof`), перевзводят свои таймеры с собственным 5%-м джиттером, а ожидавшие на `navigator.locks` вкладки видят свежий `expiresAt` в RAM и выходят из замка за `0 мс` без сетевого запроса.
  3. Выход (`{ type: 'clear' }`), вход и редактирование профиля синхронизируют все открытые вкладки мгновенно без единой лишней куки.
- На сервере в `gateway.ts` / `auth.ts` добавляется in-process `singleflight` по `jti` на время `renew`, исключающий параллельную двойную ротацию в БД при одновременных SSR-запросах.

---

### Пункт 6. Восстановление при мёртвом временном токене во время работы (заморозка мобильной вкладки)
> Ожидание: если во время работы временный токен в RAM мёртв (например, мобильный браузер заморозил фоновый таймер), вызывается Пункт 3 (продление) и операция прозрачно продолжается.

- **[КРИТИЧЕСКИЙ ПРОБЕЛ В ТЕКУЩЕМ КОДЕ]:**
  - Метод `vault.maybeRenew()` в `vault.svelte.ts:96` нигде в проекте не вызывается (`0` ссылок в `src/`).
  - Нет подписки на `visibilitychange` / `online` (при разблокировке телефона истёкший `vault` не обновляется).
  - Ни транспорт форм (`kitActionTransport` / `bindComponentForm`), ни серверный `auth(event)` не перехватывают истечение `auth_tmp` при живом `auth_sid`: отправка `ProfileForm` после сна вкладки падает ошибкой `401 auth.expired` и теряет действие пользователя.

- **Двухконтурное решение (работает и с JS, и без JS, и для будущих внешних API):**
  1. **Клиентский контур (`vault` + транспорт форм):**
     - При возврате вкладки из сна (`visibilitychange → visible`, `focus`, `online`), если `vault.authorized && overdue(expiresAt, Date.now())`, вызывается фоновый `vault.ensureFresh()`.
     - Перед отправкой защищённого запроса, если `vault.authorized && isExpired()`, транспорт дожидается `await vault.ensureFresh()`.
     - Реактивный перехват ошибки: если запрос всё равно вернул `auth.expired` (`401`), транспорт вызывает `const ok = await vault.renew()`:
       - при `ok === true` — **автоматически повторяет исходный запрос 1 раз** с тем же payload без участия пользователя;
       - при `ok === false` (отозвана или истекла сама 30-дневная сессия `auth_sid`) — вызывает `vault.clear()`, и `<Acl>` сразу показывает экран входа.
  2. **Серверный контур (`auth(event)` в `gateway.ts`):**
     - Если в защищённый серверный экшен (`updateProfile` и др.) пришёл запрос с истёкшим/отсутствующим `auth_tmp`, но **в этом же запросе есть валидный `auth_sid`**, сервер прозрачно выполняет `renew()` (выставляя новые `Set-Cookie` в ответ) и завершает операцию за **1 сетевой круговой цикл (`1 RTT`)** — в том числе у пользователей с отключённым JavaScript.

---

## 4. Статус реализации решений владельца

> **Статус:** все 5 решений ниже **реализованы в коде и покрыты unit / E2E тестами** (`auth.ts`, `gateway.ts`, `vault.svelte.ts`, `hooks/component-form/client.svelte.ts`, `+layout.server.ts`, `+layout.svelte`, `ui/*`).

1. **[ВЫПОЛНЕНО] Хранение в JS RAM (Пункт 1):** долгоживущий `auth_sid` остаётся **строго `HttpOnly`-only** (в JS никогда не передаётся), а в приватном замыкании `createVault()` хранятся метаданные короткой сессии (`expiresAt`, `ttlMs`, `sub`, `prof`) и единые read-only геттеры `vault.authorized`, `vault.principal`, `vault.profile`, `vault.renewing` (удалены `readUser`, `hydrateVault`, пропы `server` и дублирующие `readVault` на страницах).
2. **[ВЫПОЛНЕНО] Честный выход при просроченном `auth_tmp` (Пункт 2):** `logout` и `logoutAll` отзывают сессию в БД как по `auth_tmp`, так и по fallback на `auth_sid` (`RENEWAL_COOKIE`), а `requestDelete` дополнительно чистит куки.
3. **[ВЫПОЛНЕНО] SSR-восстановление новой вкладки (Пункт 4):** в `+layout.server.ts` через `resolveVault(event)` при отсутствии/истечении `auth_tmp` и наличии живого `auth_sid` выполняется бесшовный серверный `renew()` прямо во время SSR `load` (вкладка сразу рендерится авторизованной с обновлёнными куками).
4. **[ВЫПОЛНЕНО] Межвкладочная координация (Пункт 5):** реализована связка **5%-й джиттер + `navigator.locks` + `BroadcastChannel('modals-kit:user')`** + серверный `singleflight` по `jti` (`renewInFlight`) + счётчик поколений `epoch` и `AbortController` против гонок `renew ↔ logout` и `renew ↔ profileForm`.
5. **[ВЫПОЛНЕНО] Бесшовное продолжение при замороженном таймере (Пункт 6):** включены оба уровня — клиентский (`visibilitychange` + `online` + `ensureFresh` / `401 auth.expired → vault.renew() → retry` через `setFormSessionInterceptor`) **и** серверный прозрачный `renew` по `auth_sid` внутри `auth(event)`.
