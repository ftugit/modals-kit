# Аудит и самодостаточный план доводки UI-слоя (`src/components/ui` + `src/components/form`) — `UI-1`–`UI-4`

Полная ревизия принципа «один источник истины» в примитивах `ui/` и обёртках форм `form/`, сверенная построчно с исходниками репозитория и дополненная глобальными архитектурными решениями и пошаговым чек-листом.

> **Правило ведения документа (ОБЯЗАТЕЛЬНО ПРИ СЖАТИИ ИЛИ СМЕНЕ КОНТЕКСТА):**
> 1. Этот план является второй очередью работ — он выполняется **сразу после завершения `A1`–`A5` в [`./architecture.md`](./architecture.md)** (поэтому целевые пути ниже уже записаны в новой структуре `src/components/ui/*` и `src/components/form/*`).
> 2. Памятка окружения (`AUTH_SEAL_SECRET`, `PLAYWRIGHT_BROWSERS_PATH`, запуск серверов, запрет правок внутри `src/lib/form/`, пуш в `origin/img`) полностью приведена в **разделе `0` файла [`./architecture.md`](./architecture.md)**.
> 3. Четыре пересекающихся с архитектурой пункта уже включены напрямую в [`./architecture.md`](./architecture.md), чтобы не трогать одни и те же файлы дважды:
>    - **`U9`** (`aria-invalid:*` в `unocss.config.ts` + проверка `aria-*:`/`data-*:` вариантов и общая тема в `tooling/classes-audit.mjs`) → **Этап `A1.5`**;
>    - **`U2` / `F2`** (удаление мёртвого `const cls` в `form/TextareaField.svelte`) → **Этап `A1.3`**;
>    - **Мёртвые шорткаты `unocss.config.ts` + `F7` (`SearchMorph`, `NativeSelect` вне публичного барреля)** → **Этапы `A1.3` / `A1.5`**;
>    - **`F8`** (`Fieldset`-типографика в `fields/`) → **Этап `A2.2`**; **`U3`** (единый `Skeleton`) → **Этап `A3.3`**; **`U8`** (`src/components/ui/README.md`) → **Этап `A5.1`**.
> 4. По мере выполнения этапов **`UI-1` → `UI-4`** обязательно отмечай выполненные пункты `- [ ]` → `- [x]` прямо в этом файле перед коммитом каждого этапа.

---

## 1. Полная сводка находок и сверка с кодом

### 1.1. Часть 1 — `src/components/ui`: стили, токены и повторное использование

| Код | Узел (пути после `A1`) | Суть расхождения (проверено по коду) | Статус / Этап |
|---|---|---|---|
| **U1** | `ui/field/field.ts`, `ui/textarea/Textarea.svelte`, `ui/textarea/AutoTextarea.svelte`, `ui/search/SearchInput.svelte`, `ui/select/SelectList.svelte` | Константа `fieldBase` не экспортируется из `field.ts` и скопирована вручную 4 раза: `AutoTextarea` потерял `transition-colors` и имеет `py-2.5` вместо `py-2`, `SearchInput` потерял `aria-invalid:*`, `SelectList` потерял `shadow-xs`, `transition-colors`, `disabled:*`, `aria-invalid:*`. | **Этап `UI-1`** |
| **U2 / F2** | `form/TextareaField.svelte:9–13` | Мёртвая локальная константа `const cls` — полная копия `fieldBase`, нигде не передаваемая в `<Textarea>`. | Включено в **`architecture.md → A1.3`** |
| **U3** | `ui/skeleton/Skeleton.svelte`, `paginator/ui/Skeleton.svelte`, `modals/Skeleton.svelte`, `unocss.config.ts:29–33` | Три разных скелетона (`rounded-md bg-muted`, `rounded-lg bg-muted/70`, кастомный `pulse 1.4s`) + 3 мёртвых шортката в `unocss.config.ts` (`nav-pill`, `nav-pill-active`, `skeleton`). | Шорткаты → **`A1.5`**, обёртки → **`A3.3`** *(см. вопрос по канону ниже)* |
| **U4** | `ui/password/PasswordStrength.svelte:38–39` | В `src/app.css` уже объявлены семантические токены `--warning` и `--success` для обеих тем (`lemonade` / `night`), `score=1` берёт `var(--destructive)`, но `score=2..4` зашиты в светлые hex (`#d97706`, `#65a30d`, `#16a34a`). | **Этап `UI-4`** *(по подтверждению вида владельцем)* |
| **U5** | `ui/password/PasswordInput.svelte:73`, `ui/copy-input/CopyInput.svelte:90`, `ui/search/SearchField.svelte:34`, `ui/number-field/NumberField.svelte:103,115` | Внутренние кнопки-аффиксы полей написаны 4 раза вручную: в `SearchField` `w-9` и нет `disabled:*`, в `NumberField` вообще нет `focus-visible:ring-*`. | **Этап `UI-3`** |
| **U6** | `ui/file-attachment/...`, `ui/select/SelectList.svelte:398,467`, `ui/search/SearchField.svelte:44` | Одинаковый SVG-крестик `path d="m4 4 8 8m0-8-8 8"` заинлайнен 4 раза вместо единого `ui/close-icon/CloseIcon.svelte` (по образцу `CopyIcon`/`CheckIcon`/`WarningIcon`). | **Этап `UI-3`** |
| **U7** | `ui/checkbox/Checkbox.svelte:5`, `ui/attachment/Attachment.svelte:195`, `ui/switch/Switch.svelte:5` | Общая база `appearance-none` контрола выбора написана раздельно; кроме того, **дополнительная находка нашей ревизии:** у `Checkbox.svelte` и `Switch.svelte` вообще нет классов `aria-invalid:border-destructive aria-invalid:ring-destructive/20`! | Подсветка `Checkbox`/`Switch` → **`UI-1`**, общий `controlBase` → **`UI-4`** |
| **U8** | `src/components/ui/README.md` | Не зафиксировано письменное правило: когда `*Variants` живут в `<script module>`, когда в `variants.ts`, где лежат иконки и когда разрешён глубокий импорт в обход `ui/index.ts`. | Включено в **`architecture.md → A5.1`** |
| **U9** | `unocss.config.ts`, `tooling/classes-audit.mjs:29–51,168` | В `presetWind4` по умолчанию нет `aria-invalid` — все `aria-invalid:*` молча выбрасывались из CSS, а `classes-audit.mjs:168` (`^(--|aria-|data-...)`) пропускал все `aria-*:`/`data-*:` варианты мимо проверки! **Глобальное решение:** 1 строка `aria: { invalid: 'invalid="true"' }` в `unocss.config.ts` + починка `classes-audit.mjs` (проверено вживую на `@unocss/preset-wind4`). | Включено в **`architecture.md → A1.5`** |

---

### 1.2. Часть 2 — `src/components/form` и совместимость примитивов с формами

| Код | Узел (пути после `A1`) | Суть расхождения (проверено по коду) | Статус / Этап |
|---|---|---|---|
| **F1** | `form/FieldShell.svelte`, `form/CheckboxField.svelte`, `form/SwitchField.svelte` | `CheckboxField` и `SwitchField` не используют `FieldShell` и дублируют вывод `help`/`reason`/`note`/ошибки вручную — теряют `data-field={f.name}`, теряют 2-ю и последующие ошибки (`f.errors.slice(1)`), а `CheckboxField` вообще не выводит `f.help`/`f.reason`! | **Этап `UI-2`** |
| **F3** | `ui/select/Select.svelte:773–834` | `aria-invalid` уходит на скрытый `<select class="opacity-0">`, а видимый `<button data-select-trigger aria-hidden="true">` атрибута не получает и красную рамку при ошибке формы не показывает. | **Этап `UI-1`** |
| **F4** | `ui/otp-input/OtpInput.svelte:72–145` | До гидратации `<input>` красит рамку по `aria-invalid`, а после гидратации видимы 6 `<span data-otp-slot aria-hidden="true">`, которые про `aria-invalid` на прозрачном overlay-`<input>` не знают. | **Этап `UI-1`** |
| **F5** | `PasswordInput`, `CopyInput`, `PhoneInput`, `SearchInput`, `FileAttachment`, `OtpInput`, `Select` | Проп `class` сейчас в одних полях попадает на сам контрол (`Input`, `Textarea`, `Select`, `NumberField`), а в других — на внешнюю обёртку (`PasswordInput`, `CopyInput`, `SearchInput`, `OtpInput`), тогда как у `PhoneInput` и `SearchInput` для контрола введён нестандартный `inputClass`. Единый закон: **`class` — всегда на видимый контрол, `wrapperClass` — на внешнюю обёртку**. | **Этап `UI-3`** |
| **F6** | `form/resolve.ts:31`, `ui/radio-group/*`, `ui/range/*` | `field.radio(...)` (`db-demo/schema.ts:34`) сейчас рендерится выпадающим списком `SelectField`, а `field.range(...)` (`/form`, «Писем в месяц») рендерится внутри текстовой рамки `<Input type="range">` высотой `36px` с `border-input`. | **Этап `UI-4`** *(по решению владельца)* |
| **F7** | `ui/search/SearchMorph.svelte`, `ui/index.ts` | `SearchMorph` не принимает HTML-атрибуты, несовместим с формой и имеет `0` потребителей (удаляется). **Важная поправка ревизии:** `NativeSelect.svelte` удалять как файл **нельзя** (он нужен `settings/Select.svelte`), но из публичного барреля `ui/index.ts` его экспорт убирается! | Включено в **`architecture.md → A1.3`** |
| **F8** | `fields/SchemaBuilder.svelte`, `routes/(site)/(app)/form/+page.svelte:330`, `modals/+page.svelte:67` | Ручные `<div>`-рамки групп полей вместо единого `ui/Fieldset`. | `fields/` → **`A2.2`**, страницы → **`UI-2`** |
| **F9 (бонус ревизии)** | `src/lib/form/builtins.ts`, `src/lib/form/types.ts`, `src/components/form/resolve.ts` | Виды ввода перечислены в 3 местах без автоматического теста синхронности: добавление нового `input` в ядро может молча свалиться в `default: TextField`. | **Этап `UI-2`** (`resolve.test.ts`, `0` байт в бандле!) |

---

## 2. Точные технические рецепты для автономной реализации (`UI-1` → `UI-4`)

1. **`UI-1` (`fieldBase` + видимая невалидность `Select` / `OtpInput` / `Checkbox` / `Switch`):**
   - В `src/components/ui/field/field.ts`: сделать `export const fieldBase = ...`.
   - Перевести на `cn(fieldBase, ...)`:
     - `Textarea.svelte`: `cn(fieldBase, 'min-h-20 px-3 py-2 text-sm', cls)`
     - `AutoTextarea.svelte`: `cn(fieldBase, 'px-3 py-2 text-sm', 'field-sizing-content ...', cls)` (выравнивает `py-2` с `Textarea` и возвращает `transition-colors`)
     - `SearchInput.svelte`: `cn(fieldBase, 'h-9 px-3 py-2 pr-9 text-sm [&::-webkit-search-cancel-button]:appearance-none', cls)`
     - `SelectList.svelte`: `cn(fieldBase, 'h-9 min-w-0 px-3 pr-9 text-base sm:text-sm [&::-webkit-search-cancel-button]:appearance-none')`
   - В `Select.svelte`: вычислить `const invalid = $derived(rest['aria-invalid'] === true || rest['aria-invalid'] === 'true')`, передать на `<button data-select-trigger>` атрибут `data-invalid={invalid ? 'true' : undefined}` и классы `data-[invalid=true]:border-destructive data-[invalid=true]:ring-2 data-[invalid=true]:ring-destructive/20`.
   - В `OtpInput.svelte`: вычислить тот же `invalid` и передать на каждый `<span data-otp-slot>` `data-invalid={invalid ? 'true' : undefined}` и класс `data-[invalid=true]:border-destructive`.
   - В `Checkbox.svelte` и `Switch.svelte`: добавить в базу вариантов `aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20`.

2. **`UI-2` (`FieldShell` с `labelPlacement` + тест `resolve.test.ts` + `Fieldset` на демо-страницах):**
   - В `src/components/form/FieldShell.svelte`: добавить проп `labelPlacement?: 'top' | 'end'` (по умолчанию `'top'`). При `'end'` контрол и `<Label {...f.labelProps()}>` рендерятся в `<div class="flex items-center gap-2">`, а `data-field={f.name}`, `help`/`reason`, `note`, `errors[0]`, `errors.slice(1)` и маркер `ошибка без текста` становятся **на 100% едиными** для всех 16 видимых полей формы!
   - Переписать `CheckboxField.svelte` и `SwitchField.svelte` в 6 строк поверх `<FieldShell {f} labelPlacement="end">`.
   - Добавить `src/components/form/resolve.test.ts`, проверяющий каждый известный `InputKind` из `#lib/form` против `resolve({ input })`.
   - Заменить ручные рамки групп полей в `form/+page.svelte` и `modals/+page.svelte` на `<Fieldset>`.

3. **`UI-3` (единый закон `class` / `wrapperClass` + `affixButtonVariants` + `CloseIcon`):**
   - Закон для всех составных контролов (`PasswordInput`, `CopyInput`, `PhoneInput`, `SearchInput`, `OtpInput`, `Select`, `FileAttachment`): **`class` всегда идёт на основной контрол, `wrapperClass` — на внешнюю обёртку** (проверить все вызовы по `src/` грепом перед коммитом!).
   - В `src/components/ui/field/field.ts`: экспортировать единую базу `affixButtonVariants` (с `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-50`) и применить в `PasswordInput`, `CopyInput`, `SearchField`, `NumberField`.
   - Вынести `src/components/ui/close-icon/CloseIcon.svelte` и заменить 4 инлайновых крестика SVG.

4. **`UI-4` (`PasswordStrength` токены, `controlBase`, `RadioGroup` и `Range` — по решению владельца):**
   - `PasswordStrength.svelte`: перевести цвета уровней `2..4` с hex на семантические токены темы (`var(--warning)`, `color-mix(...)` / `var(--success)`).
   - Вынести `controlBase` в `field.ts` для `Checkbox`, radio в `Attachment` и `RadioGroup`.
   - Создать примитивы `src/components/ui/radio-group/RadioGroup.svelte` (на базе `controlBase`, полная работа без JS на нативных `<input type="radio">`) и `src/components/ui/range/Range.svelte` (чистый ползунок без текстовой рамки `border-input`, с доступным фокусом и `accent-primary`) и подключить `RadioGroupField` / `RangeField` в `src/components/form/resolve.ts`.

---

## 3. Сквозной пошаговый чек-лист выполнения (`UI-1` → `UI-4`)

### Этап UI-1. Единый `fieldBase` (`U1`) и видимая невалидность всех контролов (`F3`, `F4`, `Checkbox`/`Switch`)
- [ ] **UI-1.1.** Экспортировать `fieldBase` из `src/components/ui/field/field.ts` и перевести `Textarea`, `AutoTextarea`, `SearchInput`, `SelectList` на `cn(fieldBase, ...)`.
- [ ] **UI-1.2.** Пробросить `data-invalid` и подсветку ошибки на видимый триггер `Select.svelte` (**`F3`**), слоты `OtpInput.svelte` (**`F4`**), а также добавить `aria-invalid:*` в `Checkbox.svelte` и `Switch.svelte`.
- [ ] **UI-1.3.** Прогнать `test:guard`, `test:classes`, `check`, `vitest`, `build + size-budget` и браузерные `forms.mjs`, `forms-a11y.mjs`, `auth.mjs`; отметить `[x]`, закоммитить и запушить в `origin/img`.

### Этап UI-2. Единый `FieldShell` (`F1`), контракт `resolve.test.ts` (`F9`) и `<Fieldset>` (`F8`)
- [ ] **UI-2.1.** Добавить `labelPlacement?: 'top' | 'end'` в `src/components/form/FieldShell.svelte` и перевести `CheckboxField.svelte` и `SwitchField.svelte` на `FieldShell`.
- [ ] **UI-2.2.** Написать контрактный unit-тест `src/components/form/resolve.test.ts`, сверяющий все типы полей `#lib/form` с `resolve.ts`.
- [ ] **UI-2.3.** Привести статичные группы полей на `/form` и `/modals` к `ui/Fieldset` (**`F8`**).
- [ ] **UI-2.4.** Прогнать все гейты + `forms.mjs`, `forms-a11y.mjs`, `modals.mjs`; отметить `[x]`, закоммитить и запушить в `origin/img`.

### Этап UI-3. Закон `class` / `wrapperClass` (`F5`), `affixButtonVariants` (`U5`) и `CloseIcon` (`U6`)
- [ ] **UI-3.1.** Вынести `CloseIcon.svelte` и заменить все 4 инлайновых SVG-крестика (**`U6`**).
- [ ] **UI-3.2.** Ввести `affixButtonVariants` в `field.ts` и перевести внутренние кнопки `PasswordInput`, `CopyInput`, `SearchField`, `NumberField` (**`U5`**).
- [ ] **UI-3.3.** Унифицировать контракт `class` (контрол) / `wrapperClass` (обёртка) во всех составных контролах `src/components/ui/*` и обновить все точки вызова по проекту (**`F5`**).
- [ ] **UI-3.4.** Прогнать все гейты + браузерные сьюты (`forms.mjs`, `paginate.mjs`, `shikimori.mjs`, `attachment.mjs`, `auth.mjs`); отметить `[x]`, закоммитить и запушить в `origin/img`.

### Этап UI-4. Токены `PasswordStrength` (`U4`), `controlBase` (`U7`) и примитивы `RadioGroup` + `Range` (`F6`)
- [ ] **UI-4.1.** Перевести `PasswordStrength.svelte` на семантические CSS-переменные темы (`--warning` / `--success`) для корректной работы в светлой и тёмной темах (**`U4`**).
- [ ] **UI-4.2.** Выделить общую базу `controlBase` в `field.ts` для `Checkbox`, radio карточки `Attachment` и `RadioGroup` (**`U7`**).
- [ ] **UI-4.3.** Реализовать примитивы `RadioGroup.svelte` и `Range.svelte` в `src/components/ui/` (включая no-JS работу и `layer-guard` allow-list для нативных `<input>` внутри `src/components/ui/`), подключить их в `src/components/form/` и добавить в `SCOPE` `tooling/classes-audit.mjs` (**`F6`**).
- [ ] **UI-4.4.** Прогнать полный набор гейтов и все браузерные E2E (`forms.mjs`, `forms-a11y.mjs`, `db-demo.mjs`, `auth.mjs` и др.), подтянуть `tooling/size-budget.mjs`, отметить `[x]`, закоммитить и запушить в `origin/img`.
