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

- `HEAD` = `33739c5`, `origin/img` = `33739c5`, дерево чистое.
- Тесты сейчас: `src/lib/form` — 246; `src/components/form src/hooks src/server` — 326; tooling — 145; `svelte-check` — 0/0.

## Цель

`defineForm` — единственное место, где настраивается форма. Изоморфные настройки живут в описании; неизоморфные (серверный код, хранилища, компоненты, сеть) — по одному месту на слой, без списка «опций формы».

## Решения по спорному

- `timeoutMs`: **сделано, вне этапов** — реализован (`withDeadline` в `server.ts`, `408 request.timeout`, три теста, бюджет raw 380 000 → 385 000).
- `maxBytes` vs `budget`: свести к одному имени `budget` — согласовано, делать в этапе 3.
- `execute`: остаётся вне описания. Форма входа — `form.serve({ execute })` или `register(form, { execute })` — **уточнить у владельца** в этапе 5.

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

### 2. Клиент читает настройки из описания
- [ ] `bind`: `checks` — `o.checks ?? desc.checks` (опция остаётся как перекрытие)
- [ ] `bind`: `budget` — `o.budget ?? desc.limits.budget` (уже есть, строка 550)
- [ ] `bindComponentForm` не требует `checks` на странице
- [ ] Тесты `bind`/`seed`-связки
- Проверка: `vitest run src/lib/form src/components/form`

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

1. ~~`timeoutMs` — реализовать или удалить?~~ закрыто: реализован.
2. Вход `execute`: `form.serve({ execute })` (метод описания) или `register(form, { execute })` (функция регистрации)?
3. `throttle`/`idempotency` — остаются в server-файле формы (они тянут `#server`) — подтвердить.

## Журнал

- 2026-10-25: план записан, `HEAD 33739c5`, дерево чистое, правок кода нет.
- 2026-10-25: `timeoutMs` реализован по команде «Реализуй» (вне этапов плана): `withDeadline`, `408 request.timeout`, тесты `52` в `server.test.ts`, tooling `145/145`. Этап 1 не начат.
