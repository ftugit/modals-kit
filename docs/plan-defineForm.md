# План: единый `defineForm` как единственный источник настроек формы

> Временный файл. Отмечать по ходу. **Удалить после завершения и коммита.**

## ПРОЦЕДУРА (для продолжения после обрыва/сжатия контекста)

- Ветка `img`, remote `origin` = `https://github.com/ftugit/modals-kit.git`. Пуш разрешён (207).
- VCS-гейт: перед правкой `git status --porcelain` должен быть пуст. Если грязно — коммит `wip:` сначала.
- Коммит — сразу после зелёного гейта. Гейты модуля в цикле, полный набор один раз перед коммитом.
- Слова «сделано»/«работает» — только с блоком `<evidence_block>` (GIT/GATES/SKIPPED).
- После замечания владельца: стоп, ответ, ждать решения (правило 5).
- Код — только по явной команде. Команда получена: «Запиши отдельный md план с чеклистом».
- Токены не эхоть, не коммитить.
- **Решения, зафиксированные владельцем (не пересматривать):**
  - лимит формы один: env → `min(объявленный формой)`; `maxBytes` и `budget` — одно понятие, разные имена;
  - валидатор `v.maxSize` независим от бюджета формы;
  - серверного предела на отдельный файл нет;
  - форма описывается один раз; каждый слой берёт из `defineForm` то, что умеет применить.

## Точка старта

- Обновлено 2026-10-29: выбран владельцем **приоритетом №1** перед остальными открытыми направлениями (`HEAD` = `b5701f4`).
- За время параллельных работ добавилось больше `*.form.server.ts` (включая `block.form.server.ts`, `block-delete.form.server.ts`, `profile-delete.form.server.ts`, `privacy.form.server.ts`, `vault.form.server.ts`, `upload.form.server.ts`) — этап 5 охватывает **все** зарегистрированные формы приложения.

## Цель

`defineForm` — единственное место, где настраивается форма. Изоморфные настройки живут в описании; неизоморфные (серверный код, хранилища, компоненты, сеть) — по одному месту на слой, без списка «опций формы».

## Решения по спорному

- `timeoutMs`: **сделано, вне этапов** — реализован (`withDeadline` в `server.ts`, `408 request.timeout`, три теста, бюджет raw 380 000 → 385 000).
- `maxBytes` vs `budget`: свести к одному имени `budget` — согласовано, делать в этапе 3.
- `checks` при передаче поверх описания: **слияние словарей** (`{ ...desc.checks, ...overrideChecks }`) — базовые проверки живут один раз в `defineForm`, а динамические (например `nicknameForbidden` из настроек на сервере) добавляются/перекрывают точечно без дублирования статических правил (решение владельца 2026-10-29).
- `execute` и серверная регистрация: оставляем единую точку входа `registerComponentForm({ description, execute, ... })` (и `createFormHandler({ description, execute, ... })` в библиотеке) без лишних обёрток; `checks` и `limits` из серверных и клиентских файлов убираются везде, где достаточно описания `defineForm` (решение 2026-10-29: минимум дублирования и одна точка доступа).

## Этапы

### 1. `defineForm` принимает изоморфные настройки
- [ ] `FormDefinition` получает `budget?: number` (дубль `limits.budget` не нужен, оставить одно поле)
- [ ] `FormDefinition` получает `limits?: Partial<FormIntakeLimits>` — `maxKeys`, `maxValuesPerKey`, `timeoutMs`
- [ ] `FormDefinition` получает `checks?: CheckRegistry`
- [ ] `FormDefinition` получает `invalidFrom?: InvalidFrom`
- [ ] `checks`/`invalidFrom` кладутся в `FormDescription` (публичное поле)
- [ ] Валидация объявления: отрицательные/нулевые числа → дефект `spec.limit`
- [ ] Тесты `describe`/`budget` на новые поля
- Проверка: `vitest run src/lib/form`, `svelte-check --threshold error`

### 2. Клиент читает настройки из описания + расшифровка серверных кодов ошибок в UI
- [ ] `bind`: `checks` — слияние `{ ...desc.checks, ...o.checks }` (переданные `checks` дополняют/перекрывают базовые из описания)
- [ ] `bind`: `budget` — `o.budget ?? desc.limits.budget`
- [ ] `bind` (`applyResult` в `bind.svelte.ts`): прогонять входящие серверные `result.errors` через `normalizeErrors(result.errors, render, desc.policy.limits)` (работает одинаково для JS `fetch`/`wss://` и SSR `continuation` без JS)
- [ ] Ядро `#lib/form/messages.ts` перевести на компактный базовый английский словарь `en`, а русский словарь системных кодов вынести в UI-слой `src/components/form/messages.ru.ts` (`forms.config.ts`) — закрывает перерасход бюджета `tooling/form-size.test.mjs` и открывает контракт `EN + code → RU UI` для всех новых форм
- [ ] `bindComponentForm` не требует `checks` на странице
- [ ] Тесты `bind`/`seed`-связки и расшифровки серверных кодов через UI-словарь
- Проверка: `vitest run src/lib/form src/components/form`, `node --test tooling/form-size.test.mjs`

### 3. Одно имя для лимита веса
- [ ] `Limits.maxBytes` → `Limits.budget` (приём + `DEFAULT_LIMITS`)
- [ ] `createFormHandler`: один расчёт `min(описание.budget ?? limits.budget, limits.budget)` в момент создания
- [ ] `withCeiling` и второй `effectiveBudget` удалить; `FormLimits` — только производные (`filesBytes`, `fileFields`)
- [ ] `bodyLayer` режет по `ctx.limits.budget`
- [ ] Тесты бюджета переписать; README `lib/form` — раздел «Бюджет тела и файлов»
- Проверка: `vitest run src/lib/form`, `node --test tooling/*.test.mjs`

### 4. Сервер читает настройки из описания
- [ ] `HandlerOptions.limits`/`checks` — только перекрытие: `описание ?? опция`
- [ ] `registerComponentForm` перестаёт требовать `checks`, `limits`
- [ ] `envLimits` — единственное место потолка env; вызывается в entrypoint
- [ ] Тесты `hooks/component-form`, `server`
- Проверка: `vitest run src/hooks src/server src/lib/form`

### 5. Приложение переписано
- [ ] 6 файлов `*.form.server.ts` — без дублей `checks`
- [ ] Страницы (`/form`, `/fields`, профиль, seed) — без `checks` в связке
- [ ] `execute`: форма входа решена с владельцем и применена
- [ ] README `lib/form`, `hooks`, `components/ui` — по факту
- Проверка: полный `vitest run`, `node --test tooling/*.test.mjs`, `svelte-check`

### 6. Закрытие
- [ ] Полный гейт: `vitest run`, `node --test tooling/*.test.mjs`, `svelte-check`
- [ ] `git status` чистый, коммиты по этапам, пуш `origin img`
- [ ] Удалить `docs/plan-defineForm.md` отдельным коммитом
- [ ] Раздел «Сделано» в `docs/pending.md` §2, если остались хвосты

## Открытые вопросы к владельцу

Все вопросы закрыты (2026-10-29):
1. `timeoutMs` — реализован.
2. Вход `execute` — остаётся единый `registerComponentForm({ description, execute, ... })` / `createFormHandler({ description, execute, ... })` без дублирования `checks` и `limits`.
3. `throttle`/`idempotency`/`authorize` — остаются в серверном файле регистрации формы.
4. Переданные `checks` в `bind` / на сервере сливаются поверх `description.checks` (`{ ...desc.checks, ...override }`).

## Журнал

- 2026-10-25: план записан, `HEAD 33739c5`, дерево чистое, правок кода нет.
- 2026-10-25: `timeoutMs` реализован по команде «Реализуй» (вне этапов плана): `withDeadline`, `408 request.timeout`, тесты `52` в `server.test.ts`, tooling `145/145`. Этап 1 не начат.
