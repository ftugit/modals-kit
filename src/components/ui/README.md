# `src/components/ui` — правила слоя UI-примитивов

Базовые визуальные и интерактивные примитивы кита на **Svelte 5 + Ark UI + CVA (`variants`) + UnoCSS (Tailwind v4 preset)** с полной поддержкой работы как с JavaScript, так и при нативном HTTP без JavaScript.

---

## 1. Единственный источник истины для стилей (`*Variants` и `field.ts`)

1. **Одиночный примитив (`Button`, `Badge`, `Alert`, `Card`, `Checkbox`, `Switch`, `Label`, `Spinner`, `Skeleton`, `Separator`, `Stat`, `TimeAgo`):**
   - `export const <name>Variants = variants(...)` объявляется в `<script module lang="ts">` самого `.svelte`-файла и реэкспортируется из `src/components/ui/index.ts`.
2. **Многофайловый примитив (`attachment/`):**
   - при наличии собственной модели (`model.ts`), подкомпонентов и тестов CVA-варианты выносятся в `variants.ts` внутри папки примитива и реэкспортируются через локальный `index.ts` → `ui/index.ts`.
3. **Общие базы полей ввода (`ui/field/field.ts`):**
   - `fieldBase` — общая рамка, отступы, типографика, `focus-visible:*`, `disabled:*` и `aria-invalid:*` всех текстовых и списковых полей (`Input`, `Textarea`, `AutoTextarea`, `SearchInput`, `SelectList`);
   - `affixButtonClass` — единый стиль внутренних кнопок-аффиксов (`PasswordInput`, `CopyInput`, `SearchField`, `NumberField`);
   - `controlBase` — общая база дискретных контролов выбора (`Checkbox`, `RadioItem`, выбор карточки в `Attachment`).
   - Копировать эти цепочки классов вручную в компоненты или обёртки `src/components/form/` запрещено.
4. **Цвета и скелетоны:**
   - скелетоны модулей (`paginator`, `modals`) строятся тонкими обёртками поверх `ui/skeleton/Skeleton.svelte`;
   - статусные шкалы (`PasswordStrength`, `Alert`, `Badge`) используют только CSS-переменные темы (`--destructive`, `--warning`, `--success`), чтобы сохранять контраст и в светлой (`lemonade`), и в тёмной (`night`) темах.
5. **Время (`ui/time/`):** `TimeAgo` показывает относительный формат («N минут/дней назад», предел — месяц, дальше абсолютная дата) поверх чистой функции `formatTimeAgo`; часовой пояс всего сайта — единственная точка доступа `siteTimeZone` / `setSiteTimeZone` (`time-zone.svelte.ts`), значение пока не задаётся — работает системный пояс.

---

## 2. Иконки

- **Общие переиспользуемые иконки (`WarningIcon`, `CloseIcon`):** лежат в собственной подпапке `ui/<name>-icon/<Name>Icon.svelte` и экспортируются через `ui/index.ts`. Инлайнить повторные `<svg>` крестиков или значков предупреждения в полях и карточках запрещено.
- **Локальные иконки конкретного контрола (`CopyIcon`, `CheckIcon`):** живут рядом со своим составным примитивом (`ui/copy-input/`).

---

## 3. Публичный баррель `#components/ui/index.js` vs глубокий импорт

По умолчанию все потребители (`components/*`, `content/*`, `routes/*`) импортируют примитивы, типы и `*Variants` **только через `#components/ui/index.js`**.

Прямой (глубокий) импорт `#components/ui/<folder>/...` допускается ровно в двух случаях:

1. **Внутренние служебные носители, намеренно скрытые из публичного API:**
   - `#components/ui/select/select-trace.js` — диагностический модуль трассировки для тестов.
2. **Специализированные редкие виджеты, не нужные в общем чанке примитивов на каждом маршруте:**
   - `#components/ui/button/HoldButton.svelte` — кнопка с удержанием и собственной навигационной/анимационной логикой (`#lib/address`), подключаемая точечно там, где требуется защита от случайного нажатия, чтобы не увеличивать начальный JS-бандл остальных маршрутов (`tooling/size-budget.mjs`).

---

## 4. Контракты пропов, невалидности и автоматических проверок

- **`class` и `wrapperClass`:** проп `class` **всегда** попадает на основной интерактивный контрол (`<input>`, `<textarea>`, триггер `<Select>`, карточку `Attachment`), а внешняя обёртка составного поля (`PasswordInput`, `CopyInput`, `PhoneInput`, `SearchInput`, `OtpInput`, `Range`, `Select`, `FileAttachment`) принимает отдельный `wrapperClass`.
- **Подсветка невалидности (`aria-invalid` / `data-invalid`):** глобальный вариант `aria-invalid:` включён в `unocss.config.ts` (`aria: { invalid: 'invalid="true"' }`). Составные контролы, скрывающие нативный носитель после гидратации (`Select`, `OtpInput`), обязаны пробрасывать невалидность на видимый триггер и ячейки.
- **Без рукописных `name=` вне кита:** примитивы принимают атрибуты поля от `#lib/form` (`Field` / `bind`). Прямая установка `name="..."` на UI-примитивах в `content/*` и `routes/*` блокируется на этапе сборки плагином `tooling/layer-guard.mjs`.
- **Генерация утилит:** все файлы `src/components/ui/**` проверяются скриптом `npm run test:classes` (`tooling/classes-audit.mjs` — `0` маркер-классов, `100%` утилит сгенерированы UnoCSS).

---

## 5. Файловый ввод и подготовка картинок

Файл — одна возможность примитива, а не отдельный вид поля:

- **`FileInput`** — чистый `<input type="file">` без обёрток. Принимает `photoConvert`:
  если он задан и выбранный файл — картинка, примитив **сам** приводит её к
  параметрам спеки и кладёт готовый `File` обратно в `input.files`; не картинка —
  остаётся как есть.
- **`FileAttachment`** — гибрид: тот же `FileInput` плюс список выбранного с
  превью и иконками. Своего сжатия не делает — передаёт `photoConvert` своему
  `FileInput`. `layout` — `'row'` (файл на строку, умолчание), `'tile'` (перенос)
  или `'strip'` (одна строка со скроллом, карточки не сжимаются). При `multiple`
  выбор **копится**: второй заход в диалог не затирает первый, повторно
  выбранный файл не дублируется (сверка `name` + `size` + `lastModified`), а
  накопленный список кладётся обратно в `input.files` — форма уносит всё.
- **`convert.ts`** рядом с `FileInput` — `PhotoConvertSpec` (`width`, `height`,
  `maxBytes`, `format`) и `convertPhoto`: кадр `cover`, лучшее качество, влезающее
  в предел веса, срок на работу. Параметры приходят снаружи (у профиля —
  `specAvatar`), поэтому примитив не привязан к одному экрану.

Соглашение: подготовку значения поля делает примитив, а не `Field` и не `#lib/form`.
`Field.preview` лишь выбирает примитив — `FileAttachment` вместо `FileInput`.

---

## 6. Единые поверхности и композиция `shadcn/ui`

- **Одна внешняя рамка на поверхность (`card` vs `plain`):** модальное окно (`MODAL_POPUP_CLASS`) уже является диалоговой поверхностью (`border-border bg-card shadow`), поэтому все 15 модальных носителей — это `<Surface variant="plain" class="… p-6">`: единый внутренний отступ лежит на корне носителя. Экраны ядра (`Profile`, списки, формы, `UserConfig`, `UserPicker`, `StorageServersView`) сами являются `<Surface>`: в модалке `variant="plain"`, на странице `variant="card"`. Носитель такого экрана ставит `scroll={false}`, чтобы шапку и скролл тела держал экран, а не оболочка. Короткие носители без экранного `Surface` (фильтры, подтверждения, меню) скроллят тело сами. Вложенной карточки нет.
- **Поверхность (`ui/surface/`):** папка даёт публичную бочку `Surface` + `SurfaceBar` и контракт, который заменяет разметку вручную:
  - `Surface` (`Surface.svelte`) — корень экрана: `variant` (`'card'` по умолчанию | `'plain'`), `title`, `description`, `leading`, `controls`, `render`/`children`, `scroll`, `class`; прочие `HTMLAttributes<HTMLElement>` (включая `data-*`) уходят на `<section>`. `card` держит рамку и `p-6` на корне, `plain` не держит ни того, ни другого. Корень всегда `flex min-h-0 flex-col`, у `plain` ещё `flex-auto`.
  - **Скролл — ровно один владелец.** Шапка закреплена (`shrink-0`), тело получает `min-h-0 flex-auto overflow-y-auto overscroll-contain`; по умолчанию тело скроллится только в `plain`, на странице скроллится документ (`scroll={false}` — отключить вручную). Второй `overflow-y-auto` в носителе не добавлять.
  - `SurfaceControls` (`{ start?: Snippet; end?: Snippet }`) — тип групп шапки: `start` рисуется рядом с `leading` в левой зоне, `end` — в правой зоне (которая монтируется только при непустом `end` / `controls`). `controls` принимает и одиночный `Snippet`, и `SurfaceControls`; различение — по `typeof === 'function'`.
  - `SurfaceBar` (`SurfaceBar.svelte`) — сам ряд из трёх зон `leading` / `center` / `end`: `flex w-full flex-wrap items-center gap-x-2 gap-y-1.5`, каждая зона `overflow-x-auto` со скрытым скроллбаром (`[scrollbar-width:none] [&::-webkit-scrollbar]:hidden`) и `min-w-0`, `center` забирает свободное место (`flex-1`), `end` прижимается (`ml-auto`). Пустая зона не рендерится. Зоны помечены `data-surface-zone`.
  - `surfaceVariants` и `SurfaceVariant` реэкспортируются из `ui/index.ts` — оформление поверхности берётся оттуда, а не копируется в потребителя.
- **Экраны отказа, пустоты и ошибок (`Empty`):** полноэкранные/модальные заглушки (`Acl`, `ModalError`, пустые списки) оформляются нейтральным паттерном `Empty` (`size-10 rounded-lg bg-muted` со значком + заголовок + `text-muted-foreground` + кнопка действия), а не сплошной цветной рамкой вокруг всего контейнера.
- **Инлайновые уведомления (`Alert`):** `Alert` используется только для коротких вложенных уведомлений внутри карточки/формы; основной текст остаётся `text-foreground`, чтобы сохранять контраст WCAG AA (`>= 4.5:1`) на полупрозрачных подложках и в `lemonade`, и в `night`.
- **Гигиена раскладки и токенов:** отступы между соседями задаются только через `flex`/`grid` + `gap-*` (без `space-x-*`/`space-y-*`), переполнение строк в ячейках списков — через `truncate` (с полным значением в `title`), цвета — строго семантическими токенами темы без ручных `dark:*` и палитровых классов.
