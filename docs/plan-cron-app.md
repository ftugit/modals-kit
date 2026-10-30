# План 1: Ядро и API крона нашего приложения (`modals-kit`)

Статус: **технический план до начала написания кода** (реализация — только по отдельной команде).

---

## 1. Назначение и главные архитектурные принципы

Крон в нашем приложении решает фоновые задачи **без опроса БД на каждый пользовательский запрос**:
1. Сверка пропавших/вернувшихся файлов в облаках (`storage.reconcile`);
2. Поиск недоклонированных файлов, их серверное клонирование с прогрессивной нарезкой на части при медленном целевом сервере и возврат отчёта (`storage.clone`);
3. Фоновая конвертация тяжёлых картинок/аватаров с адаптивным ослаблением рамок веса либо штатной отменой при невозможности ужать (`image.convert`);
4. Уборка отложенных удалений аккаунтов (`auth.sweepDeletions`).

Три опоры архитектуры:
- **Строгая граница `src/lib` ↔ хуки и приложение**: `src/lib/cron` не знает ничего про SvelteKit, БД, `storage_server`, аватары или HTTP-роуты — он описывает декларативную схему задач, протокол команд/ответов и блокировки поверх абстрактного `AtomicStore` из `#lib/cache`.
- **Единый протокол с ключом задачи и полезной нагрузкой (`task` + `payload`)**: приложение отдаёт наружу **декларативную Схему (`CronManifest`)** со всеми ключами задач, ограничениями на `payload` и правилами действий при ошибках (`onError`), а затем исполняет адресные команды внешнего оркестратора.
- **Два транспорта поверх одного протокола (`wss://` + `HTTP POST`)**:
  - `wss://` (через готовый `upgradeWs` для `Vercel`, `Cloudflare` и `Node`) — основной полнодуплексный канал без 30-секундных обрывов и с бесшовной пересменкой инстанса (`rotate`) перед истечением лимита функции;
  - `HTTP GET/POST` на том же маршруте — синхронная обёртка того же протокола (необходима для **Google Apps Script**, где `UrlFetchApp` не умеет открывать WebSocket, но спокойно крутит пошаговые `POST`-вызовы внутри 6-минутного триггера).

---

## 2. Граница ответственности: `src/lib/cron` против хуков и сервера

### 2.1. Что живёт в чистой библиотеке `src/lib/cron` (`0` зависимостей от фреймворка)
1. **Конструктор задач и манифеста (`defineCronTask`, `createCronRegistry`)**:
   - описание ключа задачи (`key`), расписания/интервала или режима очереди, бюджета одного шага (`stepTimeoutMs`), безопасных границ входного `payload` (`bounds`, чтобы внешний сервис не мог прислать `parts: 100000` или бесконечный `maxBytes`) и декларативной таблицы реакций на ошибки (`onError`).
   - генерация сериализуемой схемы **`CronManifest`** + `schemaHash` (для кеширования внешним сервисом).
2. **Атомарная координация через `AtomicStore` (`#lib/cache`)**:
   - аренда на ключ задачи или конкретный элемент `store.add('cron:lease:' + task + ':' + itemKey, ownerId, leaseMs)` и продление `touch` между ступенями (два параллельных воркера никогда не возьмут один и тот же файл/аватар одновременно);
   - встроенный `AbortController` с отсечкой `stepTimeoutMs` (задача прерывается до падения всего serverless-вызова и возвращает управляемый код `'timeout'`).
3. **Транспортно-независимый обработчик протокола (`createCronSession`)**:
   - принимает JSON-сообщения (`hello` / `schema` / `discover` / `dispatch` / `ping`), валидирует `payload` по границам задачи, вызывает обработчик и отдаёт типизированные ответы (`manifest`, `discovered`, `result`, `rotate`, `idle`, `pong`);
   - следит за общим временем жизни сессии (`maxDurationMs` платформы × `0.8`): когда бюджет подходит к концу, после завершения текущего шага отдаёт кадр `rotate`, предлагая внешнему сервису переоткрыть свежий сокет;
   - включает лёгкий локальный `setTimeout`-драйвер без дрейфа для случая, когда приложение запущено постоянным Node-процессом в локальной разработке или на собственном VPS без внешнего будильника.

### 2.2. Что живёт в хуках и маршрутах приложения (`src/hooks/`, `src/server/`, `src/routes/`)
1. **`src/server/app-cron.server.ts`**:
   - подключает боевой `sharedStore` (`pgStore` в PostgreSQL);
   - регистрирует конкретные задачи приложения (`storage.reconcile`, `storage.clone`, `image.convert`, `auth.sweepDeletions`).
2. **Маршрут `/api/internal/cron/+server.ts`**:
   - проверяет авторизацию: `Authorization: Bearer <CRON_SECRET>` (постоянным по времени сравнением) либо сессию администратора (для ручного запуска с живым прогрессом из админки);
   - при `Upgrade: websocket` передаёт сокет в `upgradeWs` → `cronSession`;
   - при `GET ?mode=schema` отдаёт JSON-манифест `CronManifest` (с `ETag: "<schemaHash>"` → `304 Not Modified`);
   - при `POST` выполняет ровно одну команду протокола (`discover` или `dispatch { task, payload }`) и возвращает JSON-ответ шага (для Google Apps Script и простых HTTP-вызовов).

---

## 3. Структура Схемы (`CronManifest`) и протокол обмена

### 3.1. Декларативная схема, которую запрашивает внешний сервис
```ts
export interface CronManifest {
  readonly version: 1
  readonly schemaHash: string
  readonly tasks: readonly CronTaskSchema[]
}

export interface CronTaskSchema {
  readonly key: string                       // например 'storage.clone' | 'image.convert'
  readonly mode: 'pipeline' | 'batch'        // 'pipeline' (discover -> поштучно itemKey) или 'batch'
  readonly intervalSec: number               // как часто проверять при простое
  readonly stepTimeoutMs: number             // целевой бюджет одного вызова (например 25_000 мс)
  readonly defaults: Record<string, unknown> // стартовый payload при попытке №1
  readonly bounds: Record<string, { readonly min?: number; readonly max?: number }>
  readonly onError: readonly CronErrorRule[] // порядок действий при ошибках!
}

export type CronErrorAction =
  | {
      // Масштабирование числового поля с ростом числа неудач (например дробление на нарезки: 1 -> 2 -> 4 -> 8 -> 16)
      readonly kind: 'scale'
      readonly field: string                 // 'parts'
      readonly base: number                  // 1
      readonly factor: number                // 2 (parts = min(max, base * factor^attempt))
      readonly max: number                   // 32
      readonly iterateField?: string         // 'partIndex' (прогнать 0 .. parts - 1 отдельными шагами)
    }
  | {
      // Пошаговая смена рамок по ступеням (например смягчение лимита веса/размера картинки)
      readonly kind: 'steps'
      readonly patches: readonly Record<string, unknown>[]
    }
  | {
      // Отмена проблемного элемента после исчерпания попыток или при фатальной ошибке
      readonly kind: 'cancel'
      readonly cancelPayload: Record<string, unknown> // например { action: 'cancel' }
    }

export interface CronErrorRule {
  readonly codes: readonly string[]          // ['timeout', 'slow_target'] или ['fit_exceeded']
  readonly maxAttempts: number               // после скольких неудач переходить к следующему правилу / отмене
  readonly action: CronErrorAction
  readonly onExhausted?: 'cancel' | 'skip'   // что делать, когда исчерпан даже максимум ступеней
}
```

### 3.2. Кадры протокола (`wss://` и `HTTP POST` говорят на одном языке)
- Внешний сервис → Приложение:
  - `{ type: 'schema', knownHash?: string }` — дай актуальную схему (или подтверди `unchanged: true`);
  - `{ type: 'discover', task: string, limit?: number }` — найди список элементов, требующих обработки по ключу `task`;
  - `{ type: 'dispatch', task: string, itemKey?: string, payload?: Record<string, unknown> }` — выполни конкретную задачу с переданной полезной нагрузкой;
  - `{ type: 'ping', ts: number }`.
- Приложение → Внешний сервис:
  - `{ type: 'manifest', unchanged?: boolean, manifest?: CronManifest, maxDurationMs: number | null }`;
  - `{ type: 'discovered', task: string, items: readonly { itemKey: string; meta?: Record<string, unknown> }[], remaining: number }` (если `items.length === 0 && remaining === 0` — по этой задаче **заданий нет**);
  - `{ type: 'result', task: string, itemKey?: string, ok: boolean, errorCode?: string, report: Record<string, unknown>, remaining: number, shouldRotate?: boolean }`;
  - `{ type: 'idle' }` — по всем запрошенным ключам заданий больше нет, можно закрывать соединение (`1000`).

---

## 4. Конкретная механика ключевых задач в приложении

### 4.1. Задача `storage.clone` (поиск → клонирование → отчёт + нарезка медленного файла)
- **Схема в `CronManifest`**:
  - `defaults: { parts: 1 }`, `bounds: { parts: { min: 1, max: 32 }, partIndex: { min: 0, max: 31 } }`;
  - правило `onError` для кодов `['timeout', 'slow_target', 'network_transient']`:
    `kind: 'scale'`, `field: 'parts'`, `base: 1`, `factor: 2`, `max: 32`, `iterateField: 'partIndex'`, `maxAttempts: 5`, `onExhausted: 'skip'`.
- **Как исполняет наше приложение**:
  1. `discover`: ищет в `storage_file` записи, которые ещё не склонированы на целевой сервер пула, и отдаёт массив `{ itemKey: path, meta: { size, from, to } }` + общее число оставшихся.
  2. `dispatch` с `{ itemKey, parts: 1 }` (попытка 1): запускает потоковое клонирование целиком под `stepTimeoutMs`. Если целевой сервер медленный и срабатывает таймер — поток чисто прерывается по `AbortSignal`, убирается незавершённый хвост, и возвращается `{ ok: false, errorCode: 'slow_target' }`.
  3. Внешний сервис видит неудачу по `itemKey` и по правилу `scale` шлёт команду нарезать файл для другого сервера: сначала `parts: 2` (`partIndex: 0`, затем `partIndex: 1`). Если и половинка не успела — следующая серия дробит уже на `parts: 4`, затем `8`, `16`, `32`!
  4. На стороне `#lib/storage` метод частичного клонирования (`cloneSliced` / `copy` с `{ parts, partIndex }`) открывает у сервера-источника точный байтовый срез `lazy(path).slice(start, end)`, шифрует его независимым потоковым шардом `AES-256-GCM` (`partPath = "${path}.part.${partIndex}of${parts}"`) на целевом сервере и сохраняет промежуточный прогресс шардов; когда долит последний `partIndex === parts - 1` — фиксирует готовую нарезанную реплику в `StoredFileRecord.replicas`!
  5. В каждом ответе `report` возвращается точная сводка: `cloned` (список склонированных файлов), `inProgress` (файлы в процессе догрузки шардов) и `remaining` (сколько ещё осталось).

### 4.2. Задача `image.convert` (конвертация картинок с изменением рамок веса или отменой)
- **Схема в `CronManifest`**:
  - `defaults: { maxBytes: 20480, qualityFloor: 55, action: 'run' }`;
  - `bounds: { maxBytes: { min: 10240, max: 81920 }, qualityFloor: { min: 30, max: 90 } }`;
  - правило `onError` для кодов `['fit_exceeded', 'timeout']`:
    `kind: 'steps'`, `patches: [{ maxBytes: 32768, qualityFloor: 45 }, { maxBytes: 51200, qualityFloor: 38 }]`, `maxAttempts: 2`, `onExhausted: 'cancel'` (`cancelPayload: { action: 'cancel' }`).
- **Как исполняет наше приложение**:
  1. `discover`: находит ожидающие задания конвертации в очереди (`sharedStore`).
  2. `dispatch` с `defaults`: пытается ужать исходник в `20 КБ`. Не уложилось — возвращает `{ ok: false, errorCode: 'fit_exceeded' }`.
  3. Внешний сервис по схеме поднимает потолок веса сначала до `32 КБ`, затем до `50 КБ`. Если картинка сжалась (и проверка `stillWanted` подтвердила, что пользователь не загрузил за это время другое фото) — сохраняет файл в хранилище и закрывает задачу успехом.
  4. Если не помогла и последняя ступень (или пришёл битый исходник `corrupt_image`), внешний сервис шлёт `{ action: 'cancel' }` — приложение штатно переводит статус задачи в «не удалось обработать изображение» и удаляет временный исходник, чтобы задание не висело мёртвым грузом.

---

## 5. Этапы реализации Плана 1 (внутри `modals-kit`)

1. **Этап 1 — Ядро `src/lib/cron`**: типы `CronManifest`, `defineCronTask`, валидация `bounds`, аренда задач поверх `AtomicStore` из `#lib/cache`, транспортно-независимая сессия протокола (`manifest` / `discover` / `dispatch` / `rotate` / `idle`) и локальный таймер для `dev` / Node + юнит-тесты на `memoryStore`.
2. **Этап 2 — Расширение `#lib/storage` под нарезное клонирование реплик**: поддержка клонирования файла в `parts` независимых шардов по `partIndex` (`0 .. parts - 1`) с чтением `Range`-среза с первого сервера и сборкой готовой многошардовой реплики на целевом сервере + тесты.
3. **Этап 3 — Серверная обвязка и двухрежимный маршрут `/api/internal/cron`**: авторизация `CRON_SECRET` / `admin`, транспорт `wss://` через `upgradeWs` + синхронный `GET/POST` для Google Apps Script, подключение `storage.reconcile`, `storage.clone` и `auth.sweepDeletions` (и `image.convert` при подъёме очереди аватаров) + интеграционные тесты протокола и пересменки `rotate`.
