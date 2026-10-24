# Аудит и самодостаточный чек-лист UI-слоя (`ui-consistency.md`) — в составе единой дорожной карты `S1` → `S6`

Полная ревизия принципа «один источник истины» в примитивах `ui/` и обёртках форм `form/`, сверенная с живым кодом проекта, генератором UnoCSS и эталонами `shadcn` v4.

> **Утверждённые решения владельца (ЗАФИКСИРОВАНО):**
> 1. **`U3` (`Skeleton`):** **ДА** — канон в `ui/skeleton/Skeleton.svelte` (`animate-pulse rounded-md bg-muted`); `paginator` и `modals` строят свои скелетоны тонкими обёртками поверх него.
> 2. **`U9 / F3 / F4` (подсветка невалидности):** **ДА** — глобальный `aria: { invalid: 'invalid="true"' }` в `unocss.config.ts` + красная рамка/кольцо на всех невалидных полях, включая видимый триггер `Select`, слоты `OtpInput`, `Checkbox` и `Switch`.
> 3. **`U4` (`PasswordStrength`):** **ДА** — переход со светлых `#hex` на семантические переменные темы (`--destructive` → `--warning` → `color-mix(in oklab, var(--warning) 40%, var(--success))` → `--success`).
> 4. **`F6` (`RadioGroup` и `Range`):** **ДА, по эталонным стилям `shadcn` v4** (`apps/v4/registry/new-york-v4/ui/{radio-group,slider}.tsx` — точные рецепты классов зафиксированы ниже в `§2`, интернет при продолжении в новом чате не требуется!).
> 5. **Порядок выполнения и тестирование:** идём строго **от самых безопасных изолированных участков к фундаментальному переезду слоёв (`S1` → `S6`)**; тяжёлые прогоны тестов не тратят время на мелких изолированных этапах и запускаются единым полным контуром на финальном проверочном этапе **`S6`** сразу после большого архитектурного переезда **`S5`**. На каждом этапе выполненные пункты отмечаются `[x]` прямо в этом файле и в [`./architecture.md`](./architecture.md).

---

## 1. Сводная таблица всех находок (`U1–U9`, `F1–F9`) и их статус

| Код | Узел | Суть | Этап | Статус |
|---|---|---|---|---|
| **U1** | `ui/field/field.ts`, `Textarea`, `AutoTextarea`, `SearchInput`, `SelectList` | Экспорт единого `fieldBase` из `field.ts` и перевод всех 4 скопированных текстовых контролов на `cn(fieldBase, ...)`. | **S1** | `[x]` Выполнено |
| **U2 / F2** | `form/TextareaField.svelte` | Удаление мёртвой копии `const cls` из обёртки формы. | **S1** | `[x]` Выполнено |
| **U3a** | `unocss.config.ts` | Удаление 3 мёртвых шорткатов (`nav-pill`, `nav-pill-active`, `skeleton`). | **S1** | `[x]` Выполнено |
| **U3b** | `ui/skeleton/Skeleton.svelte`, `paginator/Skeleton.svelte`, `modals/Skeleton.svelte` | Перевод `paginator` и `modals` скелетонов в тонкие обёртки над единым `ui/skeleton/Skeleton.svelte`. | **S2** | `[x]` Выполнено |
| **U4** | `ui/password/PasswordStrength.svelte` | Перевод цветов шкалы со светлых `#hex` на токены темы `var(--warning)` / `var(--success)` (с сохранением 4 различимых градаций в обеих темах). | **S1** | `[x]` Выполнено |
| **U5** | `field.ts`, `PasswordInput`, `CopyInput`, `SearchField`, `NumberField` | Единый `affixButtonClass` с клавиатурным `focus-visible:ring-2` и `disabled:*` во всех 4 контролах с внутренними кнопками. | **S1** | `[x]` Выполнено |
| **U6** | `ui/close-icon/CloseIcon.svelte`, `FileAttachment`, `SelectList` ×2, `SearchField` | Вынесение общего примитива `<CloseIcon />` и замена всех 4 инлайновых крестиков. | **S1** | `[x]` Выполнено |
| **U7** | `field.ts`, `Checkbox`, `Attachment`, `RadioGroup` | Общий `controlBase` для `Checkbox`, `<RadioItem />` и выбора карточки в `Attachment.svelte` (удаление дублирующего `attachmentRadioClasses`). | **S2** | `[x]` Выполнено |
| **U8** | `src/components/ui/README.md` | Письменная фиксация правил UI-слоя: где живут `*Variants`, где лежат иконки, когда разрешён глубокий импорт. | **S6** | `[x]` Выполнено |
| **U9** | `unocss.config.ts`, `tooling/classes-audit.mjs` | Глобальное включение `aria: { invalid: 'invalid="true"' }` в теме UnoCSS + снятие слепой зоны на `aria-*:` и `data-*:` вариантах в `classes-audit.mjs`. | **S1** | `[x]` Выполнено |
| **F1** | `form/FieldShell.svelte`, `CheckboxField.svelte`, `SwitchField.svelte` | Проп `labelPlacement?: 'top' | 'end'` в `FieldShell` и перевод `CheckboxField` / `SwitchField` на единый `FieldShell`. | **S2** | `[x]` Выполнено |
| **F3 / F4** | `Select.svelte`, `OtpInput.svelte`, `Checkbox.svelte`, `Switch.svelte` | Проброс `data-invalid` и подсветки `border-destructive` на видимый триггер `Select`, слоты `OtpInput`, `Checkbox` и `Switch`. | **S2** | `[x]` Выполнено |
| **F5** | `PasswordInput`, `CopyInput`, `PhoneInput`, `SearchInput`, `OtpInput`, `Select`, `FileAttachment` | Единый закон: **`class` — всегда на основной контрол, `wrapperClass` — на внешнюю обёртку** (уже выполнено в `Select` и `FileAttachment`; приведены остальные 5). | **S2** | `[x]` Выполнено |
| **F6** | `ui/radio-group/{RadioGroup,RadioItem}.svelte`, `ui/range/Range.svelte`, `form/{RadioGroupField,RangeField,RatingField,resolve}` | Нативные прогрессивные примитивы `RadioGroup` и `Range` строго по эталону `shadcn` v4 + подключение в `resolve.ts`. | **S2** | `[x]` Выполнено |
| **F7** | `ui/search/SearchMorph.svelte`, `ui/index.ts` | Удаление мёртвого `SearchMorph.svelte` и скрытие внутреннего `NativeSelect` из публичного барреля `ui/index.ts` (файл `NativeSelect.svelte` остался в `ui/native-select/`; на момент ревизии он НЕ используется — `settings/Select.svelte` перешёл на enhanced `Select`, `<NativeSelect>` в дереве нет; судьбу файла решает аудит `S10`). | **S1** | `[x]` Выполнено |
| **F8** | `routes/(site)/(app)/form/+page.svelte`, `modals/+page.svelte`, `fields/SchemaBuilder.svelte` | Приведение групп полей к единому `ui/Fieldset` (`/form`, `/modals` и новый `SchemaBuilder`). | **S2 / S4** | `[x]` Выполнено |
| **F9** | `form/resolve.test.ts` | Unit-тест полноты сопоставления всех видов ввода `#lib/form` в `resolve.ts`. | **S2** | `[x]` Выполнено |

---

## 2. Зафиксированные эталонные рецепты `shadcn` v4 для Этапа `S2` (чтобы не лазить в сеть повторно)

Снято напрямую с `shadcn-ui/ui` (`apps/v4/registry/new-york-v4/ui/{radio-group,slider}.tsx`) и адаптировано под тему `src/app.css` и работу без JS:

### 2.1. `controlBase` + `RadioItem` / `RadioGroup` (`F6` + `U7`)
- **Общая база контрола выбора в `ui/field/field.ts`:**
  ```ts
  export const controlBase =
    'relative shrink-0 cursor-pointer appearance-none border border-input bg-background shadow-xs transition-[color,background-color,border-color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20'
  ```
- **`RadioGroup` (`ui/radio-group/RadioGroup.svelte`):**
  - Контейнер: `class={cn('grid gap-3', cls)}`, `data-slot="radio-group"`.
  - Опции `{ value, label, disabled? }[]` рендерят нативные `<input type="radio">` (100% работа с JS и без JS!), связанные с `<Label>` в `flex items-center gap-2.5`.
- **`RadioItem` (`ui/radio-group/RadioItem.svelte` — также заменяет ручной `<input type="radio">` в `Attachment.svelte:369`!):**
  ```ts
  cn(
    controlBase,
    'aspect-square size-4 rounded-full text-primary checked:border-primary',
    'after:absolute after:top-1/2 after:left-1/2 after:hidden after:size-2 after:-translate-x-1/2 after:-translate-y-1/2 after:rounded-full after:bg-primary after:content-[""] checked:after:block',
    cls,
  )
  ```

### 2.2. `Range` / `Slider` (`ui/range/Range.svelte` — `F6`)
- Без рамки текстового поля `border-input`! Повторяет геометрию и токены `shadcn` v4 `Slider`, сохраняя настоящий `<input type="range">` для 100% нативной доступности, клавиатуры и no-JS отправки форм:
  - Обёртка (`wrapperClass`): `'relative flex h-5 w-full touch-none items-center select-none data-[disabled=true]:opacity-50'`
  - Визуальный трек (`data-slot="slider-track"`): `'pointer-events-none relative h-1.5 w-full grow overflow-hidden rounded-full bg-muted'`
  - Заполненная часть (`data-slot="slider-range"`, `style="width: ${percent}%"`): `'h-full bg-primary'`
  - Нативный `<input type="range">` поверх трека с кастомным thumb (`[&::-webkit-slider-thumb]` + `[&::-moz-range-thumb]`): кружок `size-4 rounded-full border border-primary bg-background shadow-sm transition-[color,box-shadow] hover:ring-4 hover:ring-ring/50 focus-visible:ring-4 focus-visible:ring-ring/50`.

---

## 3. Пошаговый чек-лист `ui-consistency.md`

### Выполнено на Этапе `S1`
- [x] `unocss.config.ts`: включён `aria: { invalid: 'invalid="true"' }` в `UNO_THEME` (**`U9`**) и удалены 3 мёртвых шортката `nav-pill`, `nav-pill-active`, `skeleton` (**`U3a`**).
- [x] `tooling/classes-audit.mjs`: синхронизирована тема `aria.invalid`, исправлен фильтр вариантов `aria-*:` / `data-*:` на строке `168`, расширен `SCOPE` всеми изменёнными полями (`0` неразрешённых утилит, `0` маркер-классов).
- [x] `ui/close-icon/CloseIcon.svelte`: создан примитив и подключён в `SearchField.svelte`, `SelectList.svelte` (×2) и `FileAttachment.svelte` (**`U6`**).
- [x] `ui/field/field.ts`: экспортированы `fieldBase` и `affixButtonClass`; `Textarea`, `AutoTextarea`, `SearchInput`, `SelectList` переведены на `fieldBase` (**`U1`**); `PasswordInput`, `CopyInput`, `SearchField`, `NumberField` переведены на `affixButtonClass` (**`U5`**).
- [x] `form/TextareaField.svelte`: удалена мёртвая константа `const cls` (**`U2/F2`**).
- [x] `ui/password/PasswordStrength.svelte`: цвета уровней `2..4` переведены на `var(--warning)` и `var(--success)` (**`U4`**).
- [x] Удалён мёртвый `ui/search/SearchMorph.svelte`; из публичного барреля `ui/index.ts` убраны `SearchMorph` и внутренний `NativeSelect`, добавлены `CloseIcon`, `fieldBase`, `affixButtonClass` (**`F7`**).

### Выполнено на Этапе `S2`
- [x] **S2.1 (`F3 / F4` + `Checkbox`/`Switch`):** проброшены `data-invalid` и `border-destructive` / `ring-destructive/20` на видимый триггер `Select.svelte`, слоты `OtpInput.svelte`, `Checkbox.svelte` и `Switch.svelte`.
- [x] **S2.2 (`U7` + `F6`):** вынесен `controlBase` в `field.ts`; созданы `ui/radio-group/{RadioItem,RadioGroup}.svelte` (с сохранением `ATTACH` `#lib/form` на первой радиокнопке) и `ui/range/Range.svelte` по эталонам `shadcn` v4 выше; ручной `<input type="radio">` в `Attachment.svelte` заменён на `<RadioItem />` (`attachmentRadioClasses` удалён); созданы `form/RadioGroupField.svelte`, переведены на `<Range>` `form/RangeField.svelte` и `form/RatingField.svelte`, обновлён `form/resolve.ts` (`case 'radio': return RadioGroupField`).
- [x] **S2.3 (`F1` + `F9` + `F8`):** добавлен `labelPlacement?: 'top' | 'end'` в `form/FieldShell.svelte`, `CheckboxField` и `SwitchField` переведены на единый `FieldShell`; написан контрактный тест `form/resolve.test.ts`; проверены статичные группы полей на `/form` и `/modals` (`<Fieldset>`).
- [x] **S2.4 (`F5` + `U3b`):** унифицированы пропы `class` (на контрол) / `wrapperClass` (на внешнюю обёртку) в `PasswordInput`, `CopyInput`, `PhoneInput`, `SearchInput`, `OtpInput` (обновлён вызов в `paginator/SearchBar.svelte`); `paginator/Skeleton.svelte` и `modals/Skeleton.svelte` переведены в обёртки над `ui/skeleton/Skeleton.svelte` (удалены 4 дублирующиеся константы из `modals/svelte/classes.ts`).

### Выполнено на Этапе `S6` — все 18 пунктов (`U1–U9`, `F1–F9`) полностью закрыты
- [x] **S6.3 (`U8`):** правила UI-слоя (`*Variants`, `field.ts`, иконки, баррель `#components/ui/index.js` vs глубокий импорт, контракты `class` / `wrapperClass` и `aria-invalid`) зафиксированы в [`../../src/components/ui/README.md`](../../src/components/ui/README.md) и проверены полным набором unit-, a11y- и E2E-тестов.
