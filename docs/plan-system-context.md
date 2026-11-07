# Система — крайний случай одного действия

Статус: **известное сделано, не закоммичено.** Сессии и раздел «Не закрыто» не начаты. Площадки и тег `modules` этот файл не трогает.

Цель: человек работает в модели своими правами. `server` передаётся в конкретный вызов, у которого актора нет или модель сама запрещает это действие человеку. Порт, который всегда подставляет `SYSTEM` и не умеет принять контекст, для человеческих действий не годится.

Две константы уже есть и означают одно и то же: `SYSTEM` в `gateway.server.ts` и `SERVER` в `auth.ts`, обе `{ principal: { roles: ['server'] } }`. Третью не заводить.

---

## Эталон

Так устроены `ProfileStorePort` и `BlockStorePort`. Каждый метод принимает `DataContext`. Адаптер не выбирает права. Модель режет строку сама.

Чтение профиля:

```ts
// src/content/user/profile.ts
const row = await ports.profiles.get(
  principalOfRow({ id: g.sub, permissions: g.perms }),
  target,
)
```

```ts
// src/content/user/gateway.server.ts — profilesAdapter
async get(ctx: DataContext, authId: string) {
  const rows = await api().select(ctx, {
    filter: { field: 'auth_id', op: 'eq', value: authId },
  })
  return rows[0] ? viewOf(rows[0]) : undefined
}
```

Список блокировок — тот же приём, без порта-арбитра:

```ts
// src/content/user/blocks.ts
const res = await ports.blocks.listPage(ctx, { page, pageSize, filter, order, includeDeleted })
```

```ts
// blocksAdapter
async listPage(ctx, args) {
  return api().select(ctx, { page: args.page, limit: args.pageSize, ...slice })
}
```

Экран серверов хранилища делает это без порта вообще: `database.resource(storageServer).select({ principal })`.

Система в этом эталоне — не режим адаптера, а один вызов. Профиль человек создать не может (`insert` только у `server`). Поэтому после уже проверенного `gProfile.update` создание идёт так:

```ts
// src/content/user/profile.ts — updateProfile
if (!checkGrants(owner.principal, gProfile.update, { ownerId: target })) {
  return fail({ code: 'auth.forbidden' })
}
const existing = await ports.profiles.get(SERVER, target)
if (!existing) {
  await ports.profiles.create(SERVER, target, patch)
} else {
  await ports.profiles.update(owner, target, patch)
}
```

`get` и `update` — от человека. `create(SERVER)` — единственное действие, которое ACL человеку закрыл. Порт при этом тот же и `ctx` принимает.

Этого и должны придерживаться остальные потребители. Новый порт, новая роль и обёртка «сначала проверим в JavaScript, потом SYSTEM» не нужны.

---

## Закрыто от контекста

Здесь `SYSTEM` зашит в метод. Вызывающий не может передать свои права, даже если человек уже известен.

### `sessionsAdapter` — все методы

`src/content/user/gateway.server.ts`, `SessionStorePort` в `ports.ts`. Сигнатуры без `ctx`.

| Метод | Что делает от `SYSTEM` | Кто зовёт, когда человек уже есть |
|---|---|---|
| `get` / `byJti` | `select` по `jti`, `includeDeleted: true` | `revokeSession` после `guard` |
| `listByAuth` | `select` по `auth_id`, `includeDeleted: true` | `listSessions` после `guard` |
| `softDelete` | `delete` | `logout` при живом access, `revokeSession` |
| `softDeleteAllByAuth` | список и `delete` всех живых | `logoutAll`, `requestDelete`, `deleteProfile({ withSeed })` |
| `create` | `insert` с `jti`, версией и сроком | только вход; человека с сессией ещё нет |
| `save` | `update` версии, подсети, истории, срока | только `renew` по куке |

Первые четыре — человеческие действия, запертые в системном порте. Последние два — как раз тот крайний случай, который должен остаться системным, но не должен быть единственной дверью порта.

Пока `listByAuth` не принимает `ctx`, ACL сессии ни на что не влияет: `revokeSession` отсекает чужого сравнением `row.authId !== g.sub`, а не политикой.

### `authsAdapter` — восемь методов из десяти

`setPermissions(ctx)` и `listPage(ctx)` уже эталон. Остальное — нет.

| Метод | Зашито | Человеческие вызывающие, которым некуда передать `ctx` |
|---|---|---|
| `get` | `get`, `includeDeleted: true` | `admin.ts`, `profile.ts` (`deleteProfile`, `updateProfile`), `blocks.ts` (три проверки цели), `config-api.ts` |
| `markDeleted` | `delete` | `requestDelete`, `deleteProfile({ withSeed })` |
| `findBySeed` | `select` по `seed` | только вход и `verifySeed`; актора ещё нет |
| `findDeletedBySeed` | `select` + `includeDeleted` | только `restoreDeleted` после доказательства seed |
| `create` | `insert` | только первый вход |
| `clearDeleted` | `restore` | только `restoreDeleted` |
| `wipeCredentials` | `update` seed в `null` | только `sweepDeletions` |
| `listDeletedBefore` | `select` удалённых по сроку | только `sweepDeletions` |

`get` и `markDeleted` — дыра перед сессиями. Экран уже знает актора, а строка auth читается и гасится как `server`, поэтому `account.read` на этих путях не работает. `guard` и вход пусть продолжают звать те же методы с `SERVER` в аргументе, когда актора нет. Сейчас аргумента нет, поэтому разделить вызовы нельзя.

### `configAdapter` — все методы

`ConfigStorePort`: `row`, `rowsByUser`, `defaults`, `anyUserRow`, `insert`, `update`, `remove`. Ни один не принимает `ctx`. Все шесть обращений к `db.resource(config)` в `gateway.server.ts` идут от `SYSTEM`.

`listUserConfig` после этого сам решает, что показать:

```ts
const canReadAll = checkGrants(toPrincipal(a), gConfig.select, { ownerId: targetId })
if (!canReadAll && !editable) continue
```

`CONFIG_ACL` на этой выборке не участвует. Права ключа живут в JSON-поле `schema` и в `config-api.ts`. Это не «серверу нужно служебное поле», это второй механизм прав рядом с моделью.

Механически подставить `ctx` в текущий порт нельзя. Умолчание — строка с `auth_id = null`. Владелец свою строку видит, глобальную — нет, если не открыть её отдельно. `listUserConfig` без умолчания не соберёт значение и схему ключа. Поэтому конфиг либо остаётся известным исключением до отдельного решения, либо порт начинает принимать `ctx`, а `SYSTEM` остаётся только на чтение конкретной строки-умолчания, когда правило ключа уже пустило человека, но модель эту строку ему не отдаёт. Весь адаптер на `SYSTEM` оставлять нельзя: это не крайний случай, а обычный путь экрана.

---

## Уже умеют принять `ctx`

Здесь система стоит на конкретном вызове. Это и есть допустимая форма. Часть вызовов лишняя.

Оставить:

| Место | Почему не права человека |
|---|---|
| `blocksOf` / `blocksOfMany` → `listByTarget(SERVER)` | Проверка бана на входе. Субъект не должен спрятать блокировку тем, что сам её не видит. |
| `sweepDeletions` → `profiles.remove(SERVER)` | Планировщика нет, актора нет. Конечная зачистка. |
| `admin-bootstrap.server.ts` → `auths.insert(SERVER)` | Старт процесса, человека нет. Рядом сырой SQL по seed — тоже не экран. |
| `loadRawPoolRows` → `storageServer.select(SYSTEM)` | Пулу загрузки нужен `sealed_config`. Поле читает только `server`. |
| `updateProfile` → `profiles.create(SERVER)` | Вставка человеку закрыта. Это одно действие. |
| `saveStorageServer`, правка по `id` | `select(SYSTEM)` нужен не для «строка есть», а чтобы снять `sealed_config` и сохранить старый URL и ключ, если форма их не прислала. Поле читает только `server`. `select(ctx)` этот секрет не вернёт. |

Убрать `SYSTEM` с вызова, актор уже есть и право уже проверено:

| Место | Сейчас | Должно быть |
|---|---|---|
| `saveStorageServer`, слот | `select(SYSTEM)` по `slot` | `select(ctx)`. Занятость слота секрета не требует. |
| `removeStorageServer` | `select(SYSTEM)`, затем `delete({ principal })` | `select(ctx)` или сразу `delete(ctx)`. Отказ модели и есть «нет строки». |

Пул (`loadRawPoolRows`) не трогать: там нет человека и есть закрытое поле.

---

## До сессий

Один шаг — один коммит. Сессионный ACL и экраны не входят.

1. **Auth.** `get` и `markDeleted` принимают `ctx`, как `listPage`. Чужую живую строку читают из `admin.ts`, `profile.ts`, `blocks.ts`, `config-api.ts` через `principalOfRow`. `guard`, вход и `sweepDeletions` передают `SERVER` в этот же аргумент: им нужны `deletedAt` и `seed === null` у субъекта токена, а `readDeleted` владельцу не выдано. Новых методов не заводить. `findBySeed`, `create`, `clearDeleted`, `wipeCredentials`, `listDeletedBefore` остаются системными: актора нет, это и есть крайний случай. `deleteProfile` пока не переводить вслепую: `get` там ищет и уже удалённый аккаунт, а владелец такую строку через модель не видит.
2. **Конфиг.** Порт принимает `ctx`. Экранные чтение и запись идут от человека. `SYSTEM` остаётся только там, где правилу ключа нужна строка-умолчание, которую модель этому человеку не отдаёт. Не переносить правила ключей в JavaScript ещё раз и не оставлять адаптер целиком на `SYSTEM`.
3. **Хранилище.** Проверку слота в `saveStorageServer` и `select` в `removeStorageServer` заменить на контекст актора. Чтение `sealed_config` при правке и `loadRawPoolRows` не менять: поле закрыто, человеку его не отдать.
4. **Сессии после этого.** Порт принимает `ctx`, но человеческий `softDelete` текущая политика не пустит: `delete` только у `server` и `admin`, не у владельца. Поиск по `jti` человеку тоже закрыт: поле `read: ['server']`, а нечитаемое поле фильтровать нельзя (`filterSQL`). `create`, `save` и разбор куки остаются `SERVER`. Чем экран отзывает устройство — `id` строки или по-прежнему `jti` через сервер — в разделе «Не закрыто». Пока шаг 1 не сделан, сессионный порт будет вторым `get` без `ctx` рядом с auth.

Проверка каждого шага: человек без права получает отказ модели, не пустой список из системной выборки; `server` в диффе есть только на вызовах из таблицы «Оставить». `npm run check` и затронутые тесты портов. `allowAnomalies` не включать.

---

## Не резать выборку после базы

`select` уже не тащит закрытые колонки. `readable()` оставляет в `SELECT` только поля, которые `read` пускает этому `ctx`, плюс первичный ключ. Уже удалённые строки в выборку не входят, пока нет `includeDeleted`, а его модель пускает только при `readDeleted`. Просить `server`, получить все колонки и выкинуть лишнее в JavaScript — тот же обход, что и системный порт.

Эталон сужения — аргумент `fields` у `select`, не маппер. Список аккаунтов так и делает: фильтр и `includeDeleted` уходят в `listPage(ctx)`, счётчик считается на том же срезе.

### Модель уже умеет, слой всё равно забирает шире

| Место | Что уходит в базу | Что слой делает после | Как спросить меньше |
|---|---|---|---|
| `auths.get` | `SYSTEM` + `includeDeleted`: seed, `permissions`, `security`, `subnet_salt` | `checkTargetReachable` сам смотрит `deletedAt` и `account.readDeleted`. `profile.ts` и `blocks.ts` от строки берут факт «есть / удалена» | `get(ctx)`. Нет `readDeleted` — строки нет. `subnet_salt` в `SELECT` не войдёт. `seed` войдёт: маска `read: () => true`, как у `security` |
| `sessions.listByAuth` | `SYSTEM` + `includeDeleted`: в том числе `jti` и `version` | `openSession` оставляет `deletedAt === null && expiresAt > now`. `softDeleteAllByAuth` пропускает уже удалённые. `listSessions` из ответа выкидывает `version`, `jti` наружу всё равно кладёт | Живые строки — без `includeDeleted` и от человека: `jti` и `version` в `SELECT` не войдут. Срок — фильтр модели, когда у `expires_at` объявят оператор, не вторым проходом |
| `removeStorageServer` | `select(SYSTEM)` тянет `sealed_config` | проверяется только `existing[0]` | `select(ctx)` или сразу `delete(ctx)`. Секрет нужен пулу, не проверке «строка есть» |
| `publicProfile` | полный `select` профиля, до него отдельное чтение конфига видимости от системы | комментарий в функции: уровень сверяется ещё раз, в ответ остаются ник, аватар и `createdAt` | Строку уже прячет `PROFILE_ACL.extend`. Повторный `getEffective` не нужен. Узкие колонки — `fields`, не срез объекта |

`security` у `user.auth` слой тоже не копирует в `AuthRow`, но маска этого не запрещает: `read: () => true`, колонка в `SELECT` есть. Это не «ACL уже умеет». Маску закрыть на `server`, тогда `readable()` сам уберёт колонку. Пока маска открыта, выкидывание в `authRowOf` секрет из базы не удерживает.

### Не путать с тем, чего у модели нет

`listUserConfig` забирает все умолчания и все строки цели, потом `if (!canReadAll && !editable) continue`. Строку чужого аккаунта `CONFIG_ACL` спрячет, если передать `ctx`. Отдельный ключ по `schema.editUser` модель не понимает: правило лежит в JSON строки, не в `defineAcl`. Этот цикл не переносить в `readable()` и не считать уже решённым ACL. Пока правило ключа не в модели, умолчание читается отдельным системным вызовом, как в разделе про конфиг, а не полной пачкой с последующим `continue`.

---

## Не закрыто

Инвентарь вызовов `SYSTEM` / `SERVER` полный: константы в `gateway.server.ts`, `auth.ts` и `app-storage.server.ts`, плюс сырой SQL бутстрапа. Сырой SQL движка хранилища и кэша сюда не входит. Ниже — места, где план не может выбрать за политику.

1. **Отзыв сессии.** `listSessions` отдаёт `jti`, `revokeSession` ищет по нему и гасит от `SYSTEM`. Владелец строку выбрать может, колонку `jti` — нет, фильтр по ней модель отвергнет. `delete` владельцу тоже закрыт. Без новой роли остаются два уже существующих ручки: отзыв по `id` строки, если политику `delete` открыть владельцу, либо отзыв остаётся серверным действием по `jti` из куки и списка. Экранные сессии этим файлом не начинать, пока это не выбрано.

2. **Своя заявка на удаление.** `readDeleted` — `server`, `admin`, `account.readDeleted`, не владелец. `get(ctx)` прячет собственную строку с `deleted_at`. `deleteProfile` сейчас находит её через `SYSTEM` и идёт дальше, не глядя на метку. Если такое чтение станет человеческим, повторное удаление своего надгробия превратится в `auth.forbidden`. Чужую удалённую строку прятать — как раз цель `checkTargetReachable`. Свою — отдельный вопрос.

3. **Ответ после правки закрытого профиля.** `updateProfile` после `update(owner)` делает `get(owner) ?? get(SERVER)` и возвращает строку, которую select актора мог скрыть (`visibility = nobody`, есть `profile.edit`, нет `profile.read`). Существование перед `create(SERVER)` тоже читается от `SERVER`, иначе закрытый профиль сойдёт за отсутствующий и вставится второй. Создание оставить системным. Возвращать ли спрятанную строку редактору — не решено.
