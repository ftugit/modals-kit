# Диск (`drive`): UI-база, Attachment и OverflowMenu

> План интерфейса drive поверх готовых примитивов `#core/ui`.
> Связанные документы: `docs/plan-drive-ui.md`, `docs/plan-drive.md`, `src/core/ui/README.md`.
> Коммитов не делаем до отдельной команды. Файлы кода не меняем — только план.

---

## 1. Цель

1. Базовый UI для вложений (`Attachment`) должен подходить под **файлы и папки** drive.
2. Drive **не создаёт собственные примитивы** — использует готовый дух `#core/ui` (Surface, Card, Alert, Empty, Attachment, Floating, ButtonGroup, Badge). Если примитива не хватает — создаём его в ядре (`src/core/ui`), а не в модуле.
3. Все экраны drive **адаптивны**: кнопки не выходят за экран, контент имеет отступы, при нехватке места — скроллы.
4. Ввести примитив **OverflowMenu (троеточие)**: при JS и переполнении списка действий — выпадающее меню; при no-JS — скроллируемый блок ссылок/кнопок.

---

## 1a. UnoCSS-аудит плана (актуальная конфигурация)

Проект использует `unocss.config.ts` с `defineConfig`, `presetWind4` (Tailwind v4-совместимый preset) и встроенным reset. Кастомных `shortcuts`, `rules`, `attributify` и `presetIcons` нет; тема — семантические CSS-переменные (`UNO_THEME`: `background`, `foreground`, `card`, `muted`, `primary`, `destructive`, `info`, `success`, `warning`, `border`, `ring`, радиусы, `font`).

| Утилита/вариант из плана | Статус в `presetWind4` | Комментарий |
|---|---|---|
| `size-*`, `rounded-*`, `gap-*`, `p-*`, `px-*`, `py-*` | OK | Базовые утилиты Wind4. |
| `truncate`, `min-w-0`, `shrink-0`, `flex-1`, `min-h-0` | OK | Нужны для сжатия flex-детей и длинных имён. |
| `grid-cols-1 sm:grid-cols-2` | OK | Предпочтительнее фиксированных `basis-44`/`basis-56`. |
| `basis-44`, `basis-56` | OK, но жёстко | Валидны; лучше `basis-full sm:basis-44` или grid. |
| `p-4 sm:p-6` | OK | Адаптивный padding модалок. |
| `max-lg:` | OK | Стандартный breakpoint preset. |
| `data-[...]`, `group-data-[...]` | OK | Используются в `Floating`; не ломать синтаксис. |
| `has-[>svg]` | OK | Используется в `Alert`; Wind4 поддерживает. |
| `[scrollbar-width:none]`, `[&::-webkit-scrollbar]:hidden` | OK (arbitrary) | В `unocss.config.ts` есть postprocess для вендорных псевдоэлементов; скрытие скроллбара надо задавать явно. |
| `bg-muted/50`, `border-info/30`, `bg-info/5` | OK | Работает с opacity и токенами темы. |
| `shadow-xs`, `shadow-sm` | OK | Wind4-имена теней. |
| `text-[0.95rem]`, `pb-[max(8px,env(safe-area-inset-bottom))]` | OK (arbitrary) | Пробелы в arbitrary-значениях заменяются `_`. |
| `space-x-*` / `space-y-*` | Запрещено правилами `core/ui` | Только `flex`/`grid` + `gap-*`. |
| `dark:*`, палитровые `text-red-*`/`bg-slate-*` | Запрещено | Только семантические токены. |
| Attributify (`flex`, `p-4` как атрибуты) | Не подключён | Использовать `class`. |
| Динамические классы (`bg-${color}`) | Не извлекаются | Строить через `variants()`/статические карты. |

**Вывод:** изменений в `unocss.config.ts` не требуется — новых `shortcuts`/`rules`/`presetIcons` не добавляем; все классы плана выражаются штатным `presetWind4` и токенами `UNO_THEME`.

**Важно:** `SurfaceBar.svelte` в актуальном коде **не скрывает** скроллбар, хотя комментарий это обещает: у контейнера `overflow-x-auto`, у зон `flex min-w-0`, без `[scrollbar-width:none]`. В плане нельзя ссылаться на `SurfaceBar` как на готовый пример скрытого скроллбара — для `OverflowMenu` и фолбэков задавать скрытие явно. Рабочий пример в проекте — `paginator/filters/ActiveFilters.svelte`: `max-lg:overflow-x-auto max-lg:[scrollbar-width:none] max-lg:[&::-webkit-scrollbar]:hidden`.

---

## 2. Базовые компоненты: что реально используется в drive

| Примитив | Где живёт | Потребитель сейчас | Зачем |
|---|---|---|---|
| `Surface` | `#core/ui/index.js` | `DriveBrowse`, `DriveNodeModal`, `DriveAccessModal`, страницы `DriveNodePage`/`DriveAccessPage` | единая поверхность, один владелец скролла |
| `Listing` | `#core/ui/listing` | `DriveBrowse` | список без модели, поиск/фильтры/пагинация |
| `Button` | `#core/ui/index.js` | шапка, `DriveNodeLinks`, формы, `DriveEntry`, `DriveDavTokens` | единый вид и fallback-ссылки |
| `Badge` | `#core/ui/index.js` | `DriveNodeCard`, `DriveBrowse` (квота), `DriveDavTokens` | статусы и квота |
| `Field`, `Common` | `#core/ui/form` | `DriveFilters`, `DriveShare`, `DriveMkdir`, `DriveRename`, `DriveUpload`, `DriveMove`, `DriveCopy`, `DriveDavIssue`, `DriveOperationShell` | формы без сырых `<form>`/`<input>` |
| `forms` config | `#core/ui/form/forms.config.js` | все формы drive | единые правила полей |
| `Input` | `#core/ui/index.js` | `DriveShare` | поле пользователя |
| `Acl` | `#modules/user/base/svelte/Acl.svelte` | все носители | отказы прав |
| `asLink`, `asModalLink`, `useModalLink` | `#core/hooks/links` | `DriveBrowse`, `DriveNodeLinks`, `DriveEntry` | без JS — ссылки |
| `useHeadSeo` | `#core/ui/shell` | страницы `/drive*` | метаданные |
| `notify` | `#core/ui/notice` | `use-drive-operation` | клиентские уведомления |

**Доступно в ядре, но в drive пока не используется:** `SurfaceBar` (косвенно через `Surface`), `ButtonGroup`, `Alert`, `Select`/`SelectList`, `SearchField`/`SearchInput` (поиск идёт через `Listing`), `CopyInput`, `FileInput`/`FileAttachment` (загрузка пока `Field` + нативный input), `Floating`, `Spinner`, `Stat`, `TimeAgo`, `Skeleton`, `EmptyState` (paginator), `useGrants`, `Fieldset`. Эти примитивы — кандидаты на подключение, а не текущая зависимость.

---

## 3. Базовые компоненты, которые нужно создать/расширить в ядре

| Нужда | Предложение | Где создать | Последствия |
|---|---|---|---|
| Пустые состояния вне списка (токены, доступы) | Создать примитив `Empty` в ядре: `icon`, `title`, `description`, `action`, `size`, `variant` (`default`/`dashed`/`plain`), `align`, `role`, `data-testid` | `src/core/ui/empty/Empty.svelte` + экспорт из `index.ts` | Единый вид заглушек; `EmptyState` из `paginator/ui` остаётся для пустого списка и не дублируется |
| Вложения как файлы и папки | Расширить `AttachmentKind` значением `'folder'`; добавить `AttachmentItem.count?: number` (число объектов в папке) и `badges?: readonly string[]` (статусы «важное», «в корзине»; «общий» — когда появится поле в модели). Иконка папки — в `ICON_PATHS`. | `src/core/ui/attachment/model.ts`, `Attachment.svelte`, `variants.ts` (без изменений) | Attachment становится универсальным для drive; `DriveNodeCard` перестаёт рисовать собственную строку |
| Троеточие/переполнение действий | Создать примитив `OverflowMenu` (см. §5): `items`, `maxVisible`, `mode: 'count' \| 'fit'`, `priority`, `fallback: 'scroll' \| 'wrap' \| 'none'`, `moreLabel`, `sheetOnNarrow` | `src/core/ui/overflow-menu/OverflowMenu.svelte` + `MoreHorizontalIcon` + экспорт | Уменьшает высоту строк на мобильных; сохраняет no-JS список; требует хоста модалок (`Floating`) |
| Иконка «⋯» | Локальная иконка примитива `MoreHorizontalIcon` в `src/core/ui/overflow-menu/` | рядом с `OverflowMenu.svelte` | Не плодить общую иконку в `index.ts`, пока нужна только меню |

### 3a. `Empty`: расширенный API

```ts
export interface EmptyProps {
  icon?: Snippet
  title: string
  description?: string
  /** Основное действие: ссылка/кнопка. */
  action?: Snippet
  /** Дополнительное действие (вторая кнопка, ссылка «подробнее»). */
  secondaryAction?: Snippet
  /** `default` — нейтральная карточка; `dashed` — пустое место списка; `plain` — без рамки. */
  variant?: 'default' | 'dashed' | 'plain'
  size?: 'sm' | 'md' | 'lg'
  align?: 'center' | 'start'
  /** `status` — спокойное пустое состояние; `alert` — ошибка/недоступность. */
  role?: 'status' | 'alert'
  class?: string
  'data-testid'?: string
  children?: Snippet
}
```

- Медиа: `size-10 rounded-lg bg-muted` с иконкой (семантические токены), как в README `core/ui`.
- `dashed` — `rounded-xl border border-dashed border-border`, без цветной заливки.
- `compact` не нужен отдельным пропом: `size="sm"` + `align="start"`.
- В drive: `Empty` для `DriveDavTokens` (нет токенов), `DriveAccess` (нет доступов), а для списка/пикера — по таксономии §7a.10, через слот `EmptyState`, а не отдельный `{#if}`.
- Не заменяет `EmptyState` из paginator: тот привязан к состоянию пагинатора и остаётся детектором готовности/пустоты; `Empty` — его презентация.

---

## 4. Attachment для файлов и папок

**Что уже есть:** `Attachment` поддерживает `kind: document | image | video | audio | archive | code | file`, `layout: 'row' | 'tile'`, `size: 'sm' | 'md' | 'lg'`, `state`, `progress`, `error`, `actions`, `trigger`, `onOpen`, `mediaSlot`. `FileAttachment` добавляет `layout: 'strip'` (одна строка со скроллом) и накопление выбора.

**Расширение ядра (обратно совместимое):**

```ts
export type AttachmentKind =
  | 'document' | 'image' | 'video' | 'audio'
  | 'archive' | 'code' | 'file' | 'folder'

export interface AttachmentItem {
  // …существующие поля
  /** Для папки: число объектов внутри (показывается вместо размера). */
  count?: number
  /** Короткие статусы: «важное», «в корзине», «общий». */
  badges?: readonly string[]
}
```

- `ATTACHMENT_KIND_LABELS.folder = 'Папка'`; `ICON_PATHS.folder` — контур папки.
- `Attachment` рисует `count` как `N объектов` (если `byteSize` нет), а `badges` — как компактные чипы `rounded-md border border-border bg-muted px-1.5 py-0.5 text-xs text-muted-foreground` (семантические токены, без `Badge`, чтобы не тянуть лишний компонент в бандл `Attachment`).
- `DriveNodeCard` маппит `node.kind === 'folder' ? 'folder' : inferAttachmentKind(contentType, name)`. В текущем `DriveNodeView` **нет** `childCount` и `shared`: `count` либо не передаём, либо добавляем поле в модель/срез отдельным решением; `badges` собираем из доступных `starred`/`trashedAt` («важное», «в корзине»). «Общий» требует нового поля — не выдумываем его в UI.
- Строка drive перестаёт быть ручной: `Attachment layout="row" size="sm"` + `actions` (туда встаёт `DriveNodeLinks`/`OverflowMenu`). Детальная карточка — `Card` + `Attachment size="lg"` + метаданные (дата, владелец, доступ).
- Пустые папки/файлы без превью получают иконку автоматически; `mediaSlot` остаётся для будущих миниатюр.
- `FileAttachment` в загрузке: `layout="strip"` для выбранных файлов на мобильных, `row` — на десктопе (через CSS/проп, без нового примитива).
- **Последствия:** меняются `model.ts`, `Attachment.svelte` (`ICON_PATHS`, рендер `count`/`badges`), `index.ts` (типы уже реэкспортируются). `variants.ts` не меняется. SSR-тесты `Attachment` не ломаются, если новые поля опциональны.

---

## 5. OverflowMenu (троеточие): дизайн и API

**Задача:** один примитив ядра для списков действий. С JS и хостом модалок — первые `maxVisible` элементов видны, остальные уходят в меню «⋯». Без JS/хоста — все действия доступны в прокручиваемом блоке (или переносом).

```ts
export interface OverflowMenuItem {
  id: string
  label: string
  /** Основной путь: без JS остаётся рабочей ссылкой. */
  href?: string
  /** Только с JS; без JS такой пункт скрывается или disabled. */
  onClick?: (event: MouseEvent) => void
  icon?: Snippet
  description?: string
  shortcut?: string
  /** Короткий бейдж справа: «new», «3», «beta». */
  badge?: string
  /** Группа в меню: заголовок раздела. */
  group?: string
  disabled?: boolean
  destructive?: boolean
  /** Разделитель перед пунктом в меню. */
  separatorBefore?: boolean
  /** Не сворачивать, пока есть место. */
  primary?: boolean
}

export interface OverflowMenuProps {
  items: readonly OverflowMenuItem[]
  /** Число видимых или функция от ширины контейнера. */
  maxVisible?: number | ((width: number) => number)
  /** `count` — по числу; `fit` — по реальной ширине (ResizeObserver). */
  mode?: 'count' | 'fit'
  /** Показывать счётчик скрытых пунктов на кнопке «⋯». */
  moreBadge?: boolean
  moreLabel?: string
  /** Горизонтальный ряд (тулбар) или вертикальный стек. */
  orientation?: 'horizontal' | 'vertical'
  size?: 'sm' | 'md'
  variant?: ButtonVariants['variant']
  align?: 'start' | 'end'
  /** no-JS/без хоста: `scroll` — одна строка со скроллом, `wrap` — перенос, `none` — скрыть. */
  fallback?: 'scroll' | 'wrap' | 'none'
  fallbackClass?: string
  sheetOnNarrow?: boolean
  onOpenChange?: (open: boolean) => void
  class?: string
  'data-testid'?: string
}
```

**Поведение:**
- **JS + хост модалок:** видимые пункты — `Button`/ссылки; «⋯» — `Button size="icon-sm" variant="ghost"` с `MoreHorizontalIcon`, `aria-haspopup="menu"`, `aria-expanded`, `aria-controls`. Меню — `Floating` с `role="menu"`, пункты `role="menuitem"`, `tabindex`, стрелки/Home/End/Escape, возврат фокуса на триггер.
- **JS без хоста (SSR-тест, страница без ModalHost):** `Floating` не рисует содержимое (host = null), поэтому `OverflowMenu` сразу рендерит `fallback`-блок. Это же покрывает no-JS: `<a href>` работает, `onClick`-пункты без `href` скрываются.
- **`mode: 'fit'`:** `ResizeObserver` измеряет ширину контейнера и пунктов, показывает столько, сколько влезает, резервируя место под «⋯». На SSR — детерминированный `count`-фолбэк (без гидрационного расхождения).
- **`mode: 'count'`:** `maxVisible` — число или функция ширины; `primary` всегда видимы, пока не превышен минимум.
- **Группы/бейджи:** `group` рисует заголовок раздела (`text-xs text-muted-foreground`), `badge` — компактный `span` справа; одинаковые группы идут подряд, без повторной сортировки.
- **Доступность:** пункты с `destructive` получают `text-destructive`; `disabled` — `aria-disabled`; `separatorBefore` — `Separator`/`role="separator"`; `aria-label` меню — `moreLabel`.

**UnoCSS:** `[scrollbar-width:none] [&::-webkit-scrollbar]:hidden` для fallback; `max-lg:`/`sm:` для адаптивных порогов; `size-*`, `gap-*`, `truncate`; без `space-*`, `dark:*` и динамических классов.

**Последствия:** новый примитив в ядре; тесты SSR/no-JS и клавиатуры. Drive использует его в `DriveNodeLinks` (действия узла) и `DriveBrowse` controls (Важное / WebDAV / Корзина / Закрыть). Все действия drive — ссылки, поэтому no-JS сохраняет полный набор.

---

## 6. Адаптивность и гигиена UnoCSS

- Кнопки: `shrink-0` на иконках/бейджах, `min-w-0` на текстах, `truncate` + `title`.
- Сетки: `grid-cols-1 sm:grid-cols-2` вместо фиксированных `basis-*`; `basis-44`/`basis-56` допустимы только с адаптивным префиксом (`basis-full sm:basis-44`).
- Модалки: единый `min-h-0 flex-1` и адаптивный padding `p-4 sm:p-6` (`Surface variant="plain"`).
- Поверхности: `Surface` (`card`/`plain`) с одним владельцем скролла; `SurfaceBar` не считать готовым скрывателем скроллбара.
- Пустые состояния: `Empty` (после создания); пустой список — `EmptyState` из paginator.
- Уведомления: `Alert` с `role="status"` для спокойных и `role="alert"` для ошибок.
- Скроллбары: явно `[scrollbar-width:none] [&::-webkit-scrollbar]:hidden`; `overflow-x-auto`/`overflow-y-auto` — по оси.
- Отступы: только `gap-*`, без `space-x-*`/`space-y-*` и `mb-*`/`mt-*` между соседями.
- Цвета: только семантические токены (`bg-card`, `text-muted-foreground`, `border-border`, `bg-destructive/10`), без `dark:*` и палитровых классов.
- Размеры: `size-*` вместо пары `w-* h-*`; arbitrary-значения — с `_` вместо пробелов.
- Динамика: классы только статические или из `variants()`; никаких `bg-${tone}`.

---

## 7. Последствия и риски

- Объём изменений: средний (новый примитив + расширение Attachment + миграция drive).
- Риск регрессий SSR-тестов и селекторов `data-testid`.
- No-JS совместимость сохраняется при fallback-ссылках и скроллируемом блоке.
- Запрещённые файлы не трогаем: `tooling/mod.mjs`, сборочные/гард-скрипты, логи, `.modules/installed.json`.

---

## 7a. Этап 0: UI пикера — шаг/фильтр «выбранные»

**Проблема:** `drive.ids` уже поддержан сервером (`DRIVE_KEYS.ids`, `parseDriveIds`, `DRIVE_IDS_MAX`, `driveFilterExtras`, `loadDrivePage`), но в интерфейсе пикера нет шага «выбранные»: `DrivePicker`/`DrivePickerData` не знают `picked`, `mode` и `step`, а строка умеет только одно действие «Выбрать».

### 7a.1. Эталон, а не самопис

Делаем по уже существующему `UserPicker` (`modules/user/accounts/svelte/UserPicker.svelte`) и `user-picker-query.ts` как по UI-образцу шагов и строк — но **не** как по источнику лимитов: у `UserPicker` свои 500 ID и молчаливое усечение, у drive — 100/4000/`400` из §7a.6.

- шаги — `Steps` + `useSteps` из `#core/ui/steps`, без ручных табов;
- шапка — `Surface` + `SurfaceControls` (`start` — шаги, `end` — действия);
- строки — `ListingRow` + `Checkbox` по образцу `SeedUsersList` (чекбокс вне `<a>`, внутри `<label>`);
- действия — `Button` (`link`/`ghost`/`outline`), счётчик — `Badge`/текст `Steps`;
- пустое «выбранные» — `Empty` (из §3a), а не ручной `<p>`;
- ошибки — `Alert`, без ручных `rounded-lg border`-заглушек.

`Empty` — единственная зависимость этапа 0, которой ещё нет: создаётся в arch-этапе A3 (§8), до пикера (D2), чтобы не писать временную заглушку. Остальное (`Steps`, `Surface`, `Button`, `Checkbox`, `ListingRow`, `Badge`, `Alert`) уже есть.

Новых компонентов `DrivePickerSteps`, `DriveSelectedFilter`, `DrivePickerRow` **не создаём**: логика шага живёт в `DrivePicker`, разметка строки — в `DriveBrowse`, примитивы — в `#core/ui`.

### 7a.2. Контракт

```ts
export interface DrivePickerData {
  // …существующие поля
  readonly picked: readonly string[] // multiple; в single всегда []
  readonly mode: 'single' | 'multiple'
  readonly kind: 'any' | 'folder'
  readonly step: 'pick' | 'chosen' // в single нормализуется в 'pick'
}
```

- `drivePickerHref` получает `picked?: readonly string[]`, `mode?: 'single' | 'multiple'`, `step?: 'pick' | 'chosen'`, а также уже нормализованные `kind`, `from`, `param` и текущую папку; эти параметры не теряются при навигации. `picked` проверяется `parseDriveIdsUrl` с **URL-пределом `DRIVE_IDS_URL_MAX = 100`** (доменный `DRIVE_IDS_MAX = 200` остаётся защитой сервиса, но не пределом адреса); параметр `picked` пишется только непустым и только без overflow, а `drive.ids` для `chosen` без выбора — явный `none`; `step` — `upicks=chosen`; `mode=multiple` только для множественного. В `single` `picked`/`upicks`/`drive.ids` не пишутся, а `step=chosen` нормализуется в `pick`.
- `loadDrivePicker` читает `picked` (`parseDriveIdsUrl` с URL-пределом 100), `upicks` (как `parsePickerStep`), `mode`; для `step=chosen` передаёт `ids` в `loadDriveList` (новый override `ids`), а не собирает URL вручную. Пустой `chosen` передаёт `ids: []`, а не `undefined`. В `single` `picked`/`upicks`/`drive.ids`/`filter_owner` из прямого URL не применяются и снимаются.
- `DrivePicker` при `chosen` пишет в пагинатор `ids: picked.length ? picked.join(',') : DRIVE_IDS_NONE`; `undefined` в этом месте вернул бы полный список.
- `loadDriveList` получает `overrides.ids?: readonly string[]`; при `chosen` и пустом наборе — `ids: []` (сервер отдаёт пустой срез, UI рисует `Empty`).

**Критично для пагинатора:** override `ids` — это не только аргумент `loadDrivePage`, но и часть `extra` снапшота. Один и тот же набор должен уйти и в запрос, и в `driveFilterExtras` → `snapshot.extra`:

```ts
// Этап 0: список сохраняет legacy-потолок DRIVE_IDS_MAX = 200 и не отвечает 400
// на длинный набор. URL-предел 100 и parseDriveIdsUrl/overflow — future-миграция
// (§7a.6, §7a.7); в этапе 0 100 ограничивает только builder пикера.
const fromUrl = parseDriveIds(event.url.searchParams.get(DRIVE_KEYS.ids))
const ids = overrides.ids !== undefined ? [...overrides.ids] : fromUrl
if (ids && ids.length > DRIVE_IDS_MAX) throw error(400, 'drive.ids-too-long')

const result = await loadDrivePage(db, gate.actor, {
  // …
  ids: ids ?? undefined, // [] — явно пустой набор, undefined — без ограничения
})

const extra = driveFilterExtras(filters, ids)
// ids=[]      → extra.ids = 'none'
// ids=[a,b]   → extra.ids = 'a,b'
// ids=null    → ключа ids в extra нет
```

- В `driveSnapshot(..., extra)` передаётся именно этот `extra`; нельзя собирать `extra` повторно из URL без override.
- `overrides.ids = []` нельзя превращать в `undefined` через `?? []`/`||` — иначе `chosen` с пустым набором станет обычным списком, а не `drive.ids=none`.
- При `chosen` источник истины для пагинатора — `snapshot.extra.ids`; `fetchDrivePage` на следующей странице отправляет `drive.ids` из `extra`, поэтому значения обязаны совпадать с override.
- Пустой `chosen`: `extra.ids === 'none'`, сервер вернул `entries: []`, UI рисует `Empty`; следующая/предыдущая страница не должна «оживать» с полным списком.
- `DrivePicker` props: `initial`, `onPick` (single, обратная совместимость), `onPicked` (multiple), `onCancel`.
- `DrivePickerModal` для single кладёт `{ mode: 'single', id, label }`, для multiple — `{ mode: 'multiple', id: null, label: '', ids, labels }`; move/copy читают только single.

### 7a.2a. Матрица режимов пикера

Это **не четыре разных экрана и не четыре реализации**, а один `DrivePicker` с двумя независимыми осями. Матрица — просто 2×2-контракт: она фиксирует, что меняется в каждом пересечении, чтобы в коде не появились промежуточные режимы вроде «single, но с чекбоксами».

- `mode` отвечает на вопрос **«сколько результатов»**: `single` — ровно один (или корень), `multiple` — набор. Он меняет способ подтверждения и форму результата, но не навигацию.
- `kind` отвечает на вопрос **«что можно выбрать»**: `any` — файлы и папки, `folder` — только папки. Он меняет выдачу и доступные контролы выбора, но не способ подтверждения.
- Поэтому `single+any`, `single+folder`, `multiple+any`, `multiple+folder` — это четыре теста одного компонента, а не четыре компонента.

`kind=file` отдельно **не вводим**: серверный `kind=file` убирает папки из выдачи и ломает навигацию; файл выбирается в `kind=any`. File-only потребовал бы оставлять папки в списке и отдельно проверять тип выбранного — это отдельное расширение, не этап 0.

| `mode` | `kind` | Файл | Папка | Навигация | Выбор | Результат | Шаг |
|---|---|---|---|---|---|---|
| `single` | `any` | ✓ | ✓ | имя папки, крошки; переход внутрь | «Выбрать» на строке файла/папки; «Выбрать эту папку»; «Выбрать корень» | `{ id, label }`; `id=null` — корень; `ids` нет | только `pick` |
| `single` | `folder` | — | ✓ | имя папки, крошки; переход внутрь; файлов в списке нет | «Выбрать» на строке папки; «Выбрать эту папку»; «Выбрать корень» | `{ id, label }`; `id=null` — корень; `ids` нет | только `pick` |
| `multiple` | `any` | ✓ | ✓ | имя папки, крошки; переход внутрь | `Checkbox` на файле/папке; текущая папка и корень отдельными пунктами не добавляются | `{ ids, labels }`; `id=null`, `label=''`; одиночного target нет | `pick` → `chosen` |
| `multiple` | `folder` | — | ✓ | имя папки, крошки; переход внутрь; файлов в списке нет | `Checkbox` только на папке; до 100 | `{ ids, labels }`; `id=null`, `label=''`; одиночного target нет | `pick` → `chosen` |

В `single + folder` **выбор папки не входит внутрь**: кнопка «Выбрать» только возвращает папку как target и не меняет текущую папку. При этом имя папки и крошки по-прежнему остаются навигацией внутрь. Запрет «не входить» относится к действию выбора, а не к навигации.

**Скрытые выбранные (этап 0).** `chosen` показывает только текущую папку **с собственными фильтрами** (включая direct-URL и фильтры, применённые в самом `chosen`); фильтры, унаследованные из `pick`, к `chosen` автоматически не применяются; `kind` сохраняется. `picked` может содержать ID из других папок. `hiddenCount = pickedCount - visiblePicked`, где `visiblePicked` — `totalItems` среза `drive.ids` по всем страницам, а не размер страницы; при неизвестном `totalItems` `hiddenCount` неизвестен. Доступность Apply определяется только `canApplyChosen` (ниже). `hiddenCount>0` — состояние `chosen-hidden`: при `totalItems>0` видимые строки остаются, над ними `Alert` со счётчиком скрытых; при `totalItems=0` — `Empty` `chosen-hidden`; Apply недоступен в обоих случаях. Полный cross-folder manifest — future, не этап 0; контракт — §7a.9. В `single` скрытых нет: выбор атомарен.

**Единый предикат `Apply` и единые имена (единственное определение).** Ниже он описан один раз; §7a.3, §7a.4, §7a.6 и §7a.10 ссылаются на него, а не повторяют условие своими словами.

```ts
// visiblePicked — totalItems среза drive.ids: число picked на всех страницах,
// а не размер страницы. totalItems вне chosen — общий total списка.
// hiddenCount = pickedCount - visiblePicked; null — visiblePicked неизвестен.
export function canApplyChosen(i: {
  readonly pickedCount: number
  readonly totalItems: number | null | undefined
  readonly hiddenCount: number | null
}): boolean {
  const known = typeof i.totalItems === 'number' && Number.isFinite(i.totalItems) && i.totalItems >= 0
  if (i.pickedCount === 0) return false
  if (!known || i.hiddenCount === null) return false
  if (!Number.isInteger(i.hiddenCount)) return false
  if (i.hiddenCount < 0 || i.hiddenCount > i.pickedCount) return false
  return i.hiddenCount === 0
}
```

- `canApplyChosen` — **единственный** источник истины для доступности Apply: непустой `picked`, известный `totalItems`, целый `hiddenCount` в `0..pickedCount`, `hiddenCount === 0`. Всё остальное — «Apply недоступен», без локальных вариаций.
- Имена полей: в состоянии списка и снапшоте — `totalItems`; в тексте про `chosen` он означает `visiblePicked`. Слово `total` без уточнения в плане больше не употребляется.
- **JS:** при `canApplyChosen=false` кнопка рендерится `aria-disabled`/`disabled` с объяснением причины (`hidden>0` / total неизвестен / пусто), а не как рабочая ссылка.
- **No-JS:** при `canApplyChosen=false` ссылка Apply не рендерится вовсе (нет `href`); вместо неё — `Alert`/`Empty` и действия выхода. `aria-disabled` к ссылке не применяется: без JS это не блокировка, а всё ещё переход.
- `hiddenCount` для SSR считает сервер из `snapshot.total` среза `drive.ids` и передаёт в `DrivePickerData`; клиент не пересчитывает его из видимых строк и не заменяет `0` при неизвестном total.

**Инварианты:**

1. **Навигация не выбирает.** Имя папки, крошки, «Диск» и «перейти внутрь» — всегда ссылки; в `multiple` они не меняют `picked`, в `single` — target, и не закрывают пикер. В `single` выбор — отдельная кнопка «Выбрать»; в `multiple` — `Checkbox` рядом с именем, не внутри ссылки.
2. **Выбор не навигирует.** Клик по чекбоксу/«Выбрать» не открывает папку. У строки папки два независимых контроля: ссылка на вход и кнопка/чекбокс выбора.
3. **`single` атомарен.** Выбор сразу заменяет предыдущий и вызывает `onPick(id, label)`; шага `chosen` и кнопки «Применить» нет. `id=null` — только явный «Выбрать корень».
4. **Текущая папка и корень — выбор, а не навигация.** В `single` это отдельные кнопки «Выбрать эту папку» (только если текущая папка существует) и «Выбрать корень»; они не меняют текущую папку и не закрывают пикер сами по себе. В `multiple` текущая папка и корень **не выбираются** и соответствующих кнопок в футере нет; крошки и «Диск» по-прежнему ведут внутрь/в корень. В корне кнопка «Выбрать эту папку» не дублирует «Выбрать корень».
5. **Крошки не равны выбору.** В `single + folder` имя папки и крошки ведут внутрь, а «Выбрать»/«Выбрать эту папку»/«Выбрать корень» только возвращают target. В `multiple` крошки и имя папки меняют текущую папку, но не добавляют её в `picked`.
6. **`multiple` — только набор.** Выбор копится в `picked`; шаг `chosen` показывает срез `drive.ids`; `onPicked(ids, labels)` / «Применить» доступны ровно при `canApplyChosen` (§7a.2a). При `hiddenCount>0` `Apply` заблокирован; частичное скрытие — `list` + `Alert` с числом скрытых, полное (`totalItems=0`) — `Empty` `chosen-hidden`; одиночного `id` в multiple нет.
7. **`step=chosen` при `mode=single`** нормализуется в `pick`; в `single` этот шаг не рендерится.

**Форма результата:**

```ts
type DriveTargetPicked =
  | { seq: number; mode: 'single'; id: string | null; label: string }
  | { seq: number; mode: 'multiple'; id: null; label: ''; ids: readonly string[]; labels: readonly string[] }
```

- `DrivePickerModal` пишет вариант по `data.mode`; `DriveMove`/`DriveCopy` принимают только `mode: 'single'` и читают `id`/`label`.
- Multiple-пейлоад с любым `ids` (включая `[]`) не применяется к move/copy: компонент операции обязан проигнорировать его (и показать ошибку/уведомление), а не подставить `id=null` или первый id.
- `target_id` операции move/copy — ровно один UUID или явный `null` (корень); пустая/невалидная строка не становится корнем, строка с запятой отклоняется до сервиса. Это вторая линия защиты после `mode=single`.

**Кто какой режим использует:**

- `DriveMove`/`DriveCopy` — только `single` + `kind=folder`; в `drivePickerHref`/`asModalLink` передают `mode: 'single'` и `kind: 'folder'` явно, даже если это умолчание. В текущем коде этих параметров ещё нет — точные места ниже.
- Общий `DrivePicker` — `single` по умолчанию; `multiple` включается только явным `mode=multiple` от вызывающего экрана.
- `DrivePickerModal` не открывает multiple для move/copy; ветка multiple существует только для будущих наборов (например, групповые операции), не для `target_id`.

#### Фактические точки в текущем коде

Сверка с `DriveMove`, `DriveCopy`, `DrivePickerModal` и `DriveTargetPicked`: перечисленные ниже места обязаны получить `mode: 'single'` и проверку на отсутствие `ids` до реализации матрицы.

| Место | Сейчас | Требование |
|---|---|---|
| `DriveMove.svelte`, `pickerHref` (`drivePickerHref({...})`) | нет `mode` | `mode: 'single'`, `kind: 'folder'` |
| `DriveMove.svelte`, `asModalLink('drive.picker', {...})` | нет `mode` | `mode: 'single'`, `kind: 'folder'` |
| `DriveMove.svelte`, `$effect` с `sharedData[drivePickerChannel('target_id')]` | cast в `DriveTargetPicked`; проверяется только `seq`; `raw.id ?? ''` сразу пишется в `target_id` | пропускать только `mode==='single'`, без `ids`, с `id` = UUID или `null`; иначе не менять форму и не подставлять корень |
| `DriveCopy.svelte`, `pickerHref` | нет `mode` | `mode: 'single'`, `kind: 'folder'` |
| `DriveCopy.svelte`, `asModalLink('drive.picker', {...})` | нет `mode` | `mode: 'single'`, `kind: 'folder'` |
| `DriveCopy.svelte`, `$effect` с `sharedData[...]` | cast; только `seq`; `raw.id ?? ''` сразу в `target_id` | тот же single-guard; `ids` не должны попасть в `target_id` |
| `DrivePickerModal.svelte`, `pick(id,label)` | `{ seq: Date.now(), id, label }`, без `mode` | `mode` из `DrivePickerData`; для move/copy только single; `seq` — монотонный счётчик; multiple — отдельный `onPicked` |
| `DrivePicker.svelte` / `DriveBrowse.svelte` | есть только `onPick`; picker-проп не знает `mode`/`picked` | прокинуть `mode`; добавить `onPicked`; single-ссылки остаются выбором строки/текущей папки/корня |
| `DriveTargetPicked` (`picker-channel.ts`) | `{ seq, id, label }`, без `mode`/`ids` | discriminated union single/multiple; single не имеет `ids` |
| `DrivePickerData` (`types.ts`) | нет `mode` | `mode: 'single' \| 'multiple'` и контекст `picked`/`step` |
| `DrivePickerParams`/`drivePickerHref` (`routes.ts`) | нет `mode`; `drivePickerHref` не пишет `mode` | принимать/писать `mode`; для move/copy всегда `single`; `ids` в URL пикера не добавлять |
| `operations.server.ts`, `const targetId = text(values.target_id) || null` | принимает любую строку; move/copy передают её в сервис | до сервиса допускать только один UUID или `null`; строку с `,`/`ids` отклонять, а не превращать в корень |

- Проверка в `DriveMove`/`DriveCopy` должна быть **до** `bound.f.target_id.onInput`: `mode !== 'single'`, присутствующее `ids` (даже `[]`) или отсутствующий/невалидный `id` не меняют `target_id` и `targetLabel`.
- `DrivePickerModal` не должен создавать multiple-payload для `target_id`; single-guard в move/copy — вторая линия защиты, а не замена проверке на источнике.
- `ids` — не альтернатива `id`: multiple не подставляет `null`/первый ID и не очищает цель; при ошибке показывается сообщение, форма остаётся неизменной.

**Single-guard: точные проверки.**

- Принимается только payload с `mode === 'single'`, **без свойства** `ids` (даже `ids: []` — отказ) и с `id`, равным `null` (явный корень) или валидному UUID.
- `mode === 'multiple'` или любое присутствующее `ids` — отказ: `target_id`/`targetLabel` не меняются, первый ID не подставляется, цель не очищается и не становится корнем.
- Отсутствующий `mode` (`undefined`/`null`), неверный `mode`, а также `mode` не строка — отказ; default `single` относится только к открытию пикера (`DrivePickerData`/URL), но не к payload guard'у и не подставляет target.
- `id` отсутствует, `undefined` или невалиден (включая строку с запятой/пробелом) — отказ, а не `null`/корень; `target_id` остаётся прежним.
- Только явный `mode:'single'` + `id:null` без `ids` означает корень. `seq`/канал проверяются до записи формы; отклонённый payload не показывает частичный результат.
- Серверная проверка `target_id` (один UUID или пустое значение = корень; невалидная непустая строка и запятая — отказ) остаётся второй линией защиты после этого guard'а.

### 7a.3. UI

- `DrivePicker` владеет `picked`/`step` только в `multiple` (в модалке) и читает их из адреса на странице; в `single` накопительного `picked` и шага `chosen` нет, а `picked`/`upicks`/`drive.ids`/`filter_owner` из прямого URL игнорируются.
- `Steps`: `pick` — «Выбор файлов/папок», `chosen` — «Выбранные (N)»; переключение — `switchLocalStep`/`stepHref`, без своих классов и `ButtonGroup`. В `mode=single` шага `chosen` нет — только `pick`; `step=chosen` из адреса нормализуется в `pick`, при этом `upicks`, `drive.ids`, `filter_owner` и stale `picked` снимаются, иначе список останется срезанным или в single появится чужой набор.
- `DriveBrowse` в режиме пикера получает `picked`, `onPick`, `onPicked`, `mode`, `kind`; `Listing` получает `isSelected`; в `multiple` строка — `Checkbox` + `ListingRow`, папка остаётся ссылкой входа внутрь; в `single` — отдельная кнопка «Выбрать» на строке и ссылка имени папки для навигации. Кнопки текущей папки/корня — только в `single`.
- В `multiple` `Checkbox` — сосед ссылки имени, **не внутри `<a>`**; клик по нему не должен всплывать в навигацию. В `single` кнопка «Выбрать» — тоже отдельный control, а не обёртка ссылки.
- Навигационные ссылки пикера (имя папки, крошки, «Диск», страницы/шаг) в `multiple` несут текущие `picked`, фильтры текущего шага, `mode`, `kind`, `from`, `param` и `filter_owner=chosen`, если он уже стоит; в `chosen` — ещё `upicks=chosen` и `drive.ids`. В `pick` маркер сохраняется навигацией, но не создаётся ею; только переход `chosen → pick` ставит `filter_owner=chosen`. В `single` шаг всегда `pick`, а `picked`/`upicks`/`drive.ids`/`filter_owner` не пишутся. Навигация не меняет target.
- Футер:
  - `single`: «Отмена», «Выбрать эту папку» (только при наличии текущей папки), «Выбрать корень». Это selection-кнопки, они не навигируют; «Применить» нет — выбор уже применён.
  - `multiple`, шаг `pick`: «Сбросить выбор» (при непустом `picked`), «Отмена», переход к шагу `chosen` («Выбранные (N)»); «Применить» здесь не показываем.
  - `multiple`, шаг `chosen`: «← К выбору» (`Button variant="link"` / `stepLink`), «Применить» — ровно при `canApplyChosen` из §7a.2a; при `false` JS-кнопка `aria-disabled` с объяснением причины, no-JS ссылка не рендерится вовсе. «Сбросить фильтры» — при активных собственных фильтрах `chosen`; иначе при `hiddenCount > 0` — «Снять весь выбор» (явно очищает `picked`, сохраняет текущие фильтры с `filter_owner=chosen` и возвращает в `pick`); «Отмена».
  - `single` на шаге `chosen` не рендерится: `step=chosen` нормализуется в `pick`.
- В `chosen` список идёт через `drive.ids` (тот же `setExtra`/`stepHref`), а не через локальную фильтрацию массива: иначе пагинация и догрузка разъедутся. После `setExtra` проверять, что `snapshot.extra.ids` равен `picked.join(',')` или `'none'`, а не пустой строке/`undefined`. `snapshot.total` (`totalItems`) — число `picked` в текущем срезе на всех страницах (`visiblePicked`); `hiddenCount = picked.length - snapshot.total` только при `known(totalItems)`. Если `snapshot.total` неизвестен, не число, больше `picked.length` или `hiddenCount` некорректен, `Apply` disabled — это не `hiddenCount===0` и не повод отправлять набор.
- **`chosen` и пустая текущая страница:** при непустом `picked`, `hiddenCount===0` и известном `totalItems>0` пустой `items` — это не «обычный список» и не `empty-chosen`/`chosen-hidden`. При `page>1` показывается `empty-page` с действием «К первой странице» (сохраняя `picked`, `upicks` и собственные фильтры; `drive.ids` пересобирается из `picked`); при `page<=1` это противоречие данных (`Alert`/retry), а не `empty-page` или пустой `chosen`.
- **Граница `chosen`:** `picked` может переживать переход по папкам, но `chosen` — это срез `drive.ids` **текущей** папки с собственными фильтрами; унаследованные из `pick` `q`/`type`/датовые `from`/`to` к нему автоматически не применяются; `kind` сохраняется. Выбранные из другой папки, недоступные или скрытые собственным фильтром `chosen` не исчезают из набора, но не попадают в `total`; это `chosen-hidden`, а не удаление. В этапе 0 `Apply` при `hidden > 0` заблокирован: полный `picked` нельзя отправлять, если пользователь не может проверить скрытые строки. Показывать счётчик/`Alert` и вести к «К выбору»/«Снять весь выбор»; при активных собственных фильтрах — «Сбросить фильтры», иначе «Снять весь выбор». «Снять весь выбор» — явное действие, не молчаливая чистка. Полный кросс-папочный manifest — отдельный source/route с ACL и пагинацией, future, не этап 0; контракт — §7a.9. Если `snapshot.total` ещё неизвестен, `Apply` disabled до загрузки снапшота.
- **Частичное скрытие `chosen`:** видимые строки остаются в `Listing`, над ними `Alert` с числом скрытых; при `totalItems=0` это уже `Empty` `chosen-hidden`, а не «ничего не выбрано». `Apply` в обоих случаях отсутствует/disabled; при активных собственных фильтрах доступно «Сбросить фильтры» (набор сохраняется), иначе — «Снять весь выбор» (очищает `picked`, сохраняет фильтры с `filter_owner=chosen` и возвращает в `pick`).
- **Возврат `chosen → pick → chosen`:** при уходе в `pick` текущие фильтры сохраняются с `filter_owner=chosen`; изменение фильтра в `pick` снимает маркер, и тогда `pick → chosen` сбрасывает унаследованные pick-фильтры. Direct-URL `chosen` без маркера считается собственными фильтрами шага. Полный контракт — §7a.4.
- Для шага `chosen` helper `chosenSlice(picked)` возвращает `{ 'drive.ids': picked.length ? picked.join(',') : DRIVE_IDS_NONE }`; для шага `pick` `drive.ids` удаляется. Нельзя переиспользовать `pickedSlice` из `UserPicker` без этой поправки: там пустой набор — отсутствие среза, здесь — явный `none`.

### 7a.4. No-JS

No-JS-ссылки делятся на два класса, и их нельзя собирать вручную по-разному:

- **Остаться в пикере** — навигация, шаг, отметка, сброс. Строятся одним `drivePickerHref` (шаг — через `stepHref`); сохраняют контекст пикера и не трогают target вызывающей страницы.
- **Выйти в `from`** — выбор в `single`, Apply в `multiple`, отмена. Строятся одним `applyHref`; используют валидированные `from`/`param`, не добавляют в адрес вызывающей страницы ключи пикера и не меняют текущую папку пикера.

`single` и `multiple` — разные no-JS-контракты. В `single` нет накопительного набора. В `multiple` есть `pick`/`chosen` и Apply.

**Отметка строки без JS (прогрессивное улучшение).** Чекбокс — это JS-состояние, а не no-JS-контракт: без JS нативного переключения нет, и SSR не может «поставить галочку» GET-переходом.

- SSR всегда рендерит отметку как **GET-ссылку** (`Button href`/`<a>`) на `drivePickerHref` с `picked ± id`: `aria-pressed="true|false"`, `data-testid="drive-pick-toggle"`, доступное имя «Отметить»/«Снять отметку». Ссылка не навигирует по папкам и не меняет target.
- При гидрации ссылка заменяется/дополняется примитивом `Checkbox` (сосед ссылки имени, не внутри `<a>`); клик по чекбоксу меняет только `picked` и не всплывает в навигацию.
- Оба варианта дают один и тот же URL-контракт: `picked` в адресе пикера, предел 100, без `upicks`/`drive.ids` в `pick`.
- Проверка: SSR-разметка содержит `aria-pressed` и рабочий `href` отметки; после гидрации тот же элемент — `Checkbox`; no-JS клик по отметке меняет `picked` и остаётся в `pick`.

#### Single: только GET-выбор

- `drivePickerHref` для single несёт `mode=single`, `kind`, адресный `from`, `param`, текущую папку и активные pick-фильтры `q`/`type`/датовые `from`/`to`; они нужны для поиска кандидата. `picked`, `upicks`, `drive.ids` и `filter_owner` в single не пишутся, не сохраняются и не применяются из прямого URL.
- Навигация (имя папки, крошки, «Диск», страницы пагинатора) остаётся в пикере, сохраняет `mode`/`kind`/`from`/`param` и не устанавливает target.
- Выбор строки, текущей папки или корня — GET-переход в `from` через `applyHref`: строка/текущая папка ставят `param` в ID, корень удаляет `param`. Это единственный способ заполнить target.
- Кнопки «Применить» в single нет; отдельного накопительного шага перед выбором нет. «Отмена» возвращает валидированный `from` без изменений.
- `single` не добавляет в `from` `picked`, `upicks`, `drive.ids`, `filter_owner` и не отправляет POST.

#### Multiple: отметка, chosen и GET-применение

`drivePickerHref`/`stepHref` в multiple сохраняют `mode`, `kind`, адресный `from`, `param`, текущую папку, `picked` и фильтры текущего шага. В `pick` это pick-фильтры `q`/`type`/датовые `from`/`to`, если нет `filter_owner=chosen`; после возврата с маркером те же фильтры остаются собственными фильтрами `chosen`. При обычном `pick → chosen` без маркера они автоматически не переносятся; с маркером сохраняются. В `chosen` пишутся `upicks=chosen` и `drive.ids=picked.join(',')` (`none` при пустом наборе); собственные фильтры `chosen` (direct URL или применённые в шаге) сохраняются и участвуют в срезе.

**Возврат `chosen → pick → chosen`.** Собственные фильтры `chosen` переживают возврат, пока пользователь не изменил фильтры в `pick`. Переход `chosen → pick` сохраняет текущие `q`/`type`/датовые `from`/`to`, `picked` и ставит внутренний маркер `filter_owner=chosen`; `pick` показывает эти фильтры как контекст, но они всё ещё принадлежат `chosen`. Любое изменение фильтра в `pick` снимает `filter_owner=chosen`: это уже pick-фильтры, и они не наследуются обратно. `pick → chosen` сохраняет фильтры только при `filter_owner=chosen`; без маркера сбрасывает унаследованные pick-фильтры. Direct-URL `chosen` без маркера считается собственными фильтрами, потому что шаг уже `chosen`.

**`filter_owner`: точный URL-контракт.**

- Ключ — ровно `filter_owner`, единственное допустимое значение — `chosen`. Это служебный ключ пикера, а не фильтр: он не входит в `codec`, `drive.ids`, `snapshot.extra` или адрес `from`.
- Пишется только в `multiple` при переходе `chosen → pick` (включая возврат из `empty-chosen`/`empty-chosen-hidden`), вместе с текущими `q`/`type`/датовыми `from`/`to`; навигация в `pick` и `chosen` сохраняет уже стоящий маркер, но не создаёт его в `single` и не добавляет в `from`.
- Снимается при любом изменении `q`/`type`/датовых `from`/`to` в `pick`, при нормализации `single` и при «Сбросить фильтры» в `chosen`. Обычная пагинация и переходы по папкам его не снимают.
- Валидация: ровно одно вхождение и значение `chosen`; при `mode=single` или другом/повторном значении маркер отбрасывается без `400` и фильтры трактуются по обычному шагу. Маркер не делает невалидный фильтр валидным: `q`/`type`/`from`/`to` проходят обычную схему.
- При `pick → chosen`: маркер есть → текущие фильтры сохраняются как собственные; маркера нет → унаследованные pick-фильтры сбрасываются. В `chosen` маркер может оставаться как инертный контекст; direct-URL `chosen` без маркера всё равно считается собственными фильтрами. В `single` маркера нет.

**Шаг `pick`:**

- Навигация (имя папки, крошки, «Диск», страницы) сохраняет `picked`, текущие фильтры, `filter_owner` и контекст, не устанавливает target; без маркера это pick-фильтры, с `filter_owner=chosen` — собственные фильтры `chosen`.
- `Checkbox` строки меняет только `picked`, не входит в папку, не переключает шаг и не устанавливает target; в `pick` `upicks`/`drive.ids` не пишутся.
- Любое изменение `q`/`type`/датовых `from`/`to` в `pick` снимает `filter_owner=chosen`: фильтры становятся pick-фильтрами и не наследуются при следующем `pick → chosen`.
- «Сбросить выбор» очищает `picked` и остаётся в `pick`; `upicks`/`drive.ids` снимаются, target не заполняется.

**Шаг `chosen`:**

- `pick → chosen` сохраняет `picked`, ставит `page=1` и пишет `upicks=chosen`/`drive.ids`. Если стоит `filter_owner=chosen` (возврат из `chosen` без правок в `pick`), собственные фильтры сохраняются; иначе сбрасываются **унаследованные** pick-фильтры `q`/`type`/датовые `from`/`to`. Direct-URL `chosen` не нормализуется в безфильтровый экран; target не устанавливается.
- Навигация сохраняет `picked`, `upicks=chosen`, `drive.ids`, собственные фильтры текущего `chosen` и `filter_owner=chosen`, если он уже стоит; не устанавливает target.
- «Сбросить фильтры» очищает только собственные фильтры текущего `chosen`, ставит `page=1`, снимает `filter_owner=chosen` и сохраняет `picked`, `upicks=chosen`, `drive.ids`, `mode`/`kind`/`from`/`param`; это не чистит набор и не возвращает pick-фильтры.
- Снятие отметки меняет `picked` и пересчитывает `drive.ids` (`none` при пустом наборе), не возвращает полный список; скрытые выбранные остаются в `picked`.
- «Снять весь выбор» доступно, когда активных собственных фильтров `chosen` нет; оно очищает `picked`, снимает `upicks`/`drive.ids` и возвращает в `pick`; текущие фильтры сохраняются с `filter_owner=chosen`, чтобы возврат не выдал их за pick-фильтры. Это явная очистка выбора, не навигация по папкам. При активных фильтрах сначала доступно только «Сбросить фильтры».
- «Применить» — GET в `from` с `param=picked.join(',')`; ссылка рендерится только при `canApplyChosen` (§7a.2a). Пустой `chosen`, `hidden>0` и неизвестный `totalItems` показывают `Empty`/`Alert` без Apply; пустой список в `from` не отправляется.
- «Отмена» возвращает валидированный `from` без изменений.

#### Общие правила

- `param` в адресе пикера — **имя** поля вызывающей страницы, а не выбранное значение. Навигация и отметка его сохраняют, но target не заполняют.
- `picked`, `upicks`, `mode`, `kind`, `from`, `param`, `filter_owner` и `drive.ids` **не добавляются как самостоятельные ключи** в адрес `from`: это контекст пикера, а не результат выбора. Существующие query-ключи самого `from` не вычищаются — это данные вызывающей страницы.
- Ссылки пагинатора в пикере строятся как список-current-folder + picker-context, а не голым `driveListHref`: иначе страница 2 потеряет `picked`/`from`/`param` в multiple.
- Выбор никогда не меняет текущую папку пикера; навигация никогда не заполняет target. Это две независимые оси.

### 7a.5. Файлы и проверки

- `types.ts`, `routes.ts`, `sections/drive/load.server.ts`, `source.ts`, `DrivePicker.svelte`, `DrivePickerModal.svelte`, `operation/picker-channel.ts`, `DriveBrowse.svelte`, `DriveMove.svelte`/`DriveCopy.svelte` (явные `mode: 'single'`, `kind: 'folder'`), `Listing.svelte`/`types.ts` (проброс `empty`), `DrivePicker.ssr.test.ts`, `DriveBrowse.ssr.test.ts`, новые тесты `drive-picker-query`.
- `modules/drive/README.md`: снять статус «шаг не проведён», описать `picked`/`upicks`/`mode`, `drive.ids` и `filter_owner`; отдельно зафиксировать, что в `single` нет `picked`/`upicks`/`drive.ids`/`filter_owner`.
- Проверки: `multiple` SSR/no-JS (шаг, пустой chosen, папка, частичное скрытие `chosen` и полное `chosen-hidden`), `multiple` JS (отметка/снятие, счётчик, сброс, apply), `single` SSR/no-JS (только `pick`, GET-выбор строки/текущей папки/корня, без `Apply`, `picked`, `upicks`, `drive.ids` и `filter_owner`), матрица §7a.2a (single/multiple × any/folder), предел `DRIVE_IDS_URL_MAX = 100` в URL и `DRIVE_IDS_MAX = 200` в сервисе, отсутствие `drive.ids` в адресе вызывающего (`url: false`), `data-testid` прежних кнопок.
- Навигация vs выбор: в `single+folder` имя/крошки ведут внутрь, «Выбрать» не ведёт; current/root selection только в `single`, в корне нет дубля. В `multiple` нет current/root selection-кнопок; крошки/имя папки сохраняют `picked`, а в `chosen` — ещё `upicks`; чекбокс не внутри ссылки; `Apply` есть только в `chosen`.
- Отдельные проверки move/copy: ссылки пикера строятся с `mode=single`, `kind=folder`; single-guard принимает только `mode:'single'` без `ids` и с UUID либо явным `id:null`; `mode:'multiple'`/любое `ids` (включая `[]`) не меняет `target_id` и даёт ошибку; отсутствующий/неверный `mode` игнорируется без default-`single`; отсутствующий/невалидный `id` не превращается в корень и не очищает `target_id`; `id:null` допустим только как явный корень; `target_id` с запятой отклоняется сервером.
- Возврат `chosen → pick → chosen`: `filter_owner=chosen` сохраняет собственные фильтры; изменение фильтра в `pick` снимает маркер и сбрасывает унаследованные pick-фильтры; direct-URL `chosen` трактует фильтры как собственные.
- Отдельные тесты `loadDriveList`: `overrides.ids=[]` → `loadDrivePage` получил `ids: []` и `snapshot.extra.ids === 'none'`; `overrides.ids=[a,b]` → `snapshot.extra.ids === 'a,b'`; без override и без `drive.ids` → ключа `ids` в `snapshot.extra` нет; `drive.ids=none` из URL → `ids: []` и `extra.ids='none'`.
- Тест `multiple` «chosen не разъезжается»: после `setExtra({ ids: [] })` следующая страница (`fetchDrivePage`) отправляет `drive.ids=none`, а не полный список; `single` этот путь не использует.
- Тесты §7a.6 (drive-контракт, не `UserPicker`): 100 ID — ок, 101 ID / строка > 4000 символов — `overflow` и 400 без частичного результата; `USER_PICKER_IDS_MAX = 500` не используется, 500 ID не усекаются молча; `from` external/`//`/сам пикер/длиннее 2048 — `/drive`; `param` с пробелом или зарезервированный — `id`; no-JS apply — GET, остальные query `from` сохранены, целевой `param` заменён/удалён для корня, пустой multiple и `hidden>0` не применяются; `picked`/`upicks`/`mode`/`kind`/`from`/`param`/`filter_owner`/`drive.ids` не добавлены в `from`.
- No-JS ссылки: в `multiple` навигация/шаг/отметка сохраняют `picked`, `upicks` (только в `chosen`), `filter_owner` (при возврате из `chosen`), `mode`, `kind`, `from`, `param` и текущую папку; отметка не навигирует; current/root selection не меняет папку; «Отмена» возвращает `from` без target; пагинатор не теряет контекст; в `single` навигация сохраняет `mode`/`kind`/`from`/`param`/фильтры, но не пишет `picked`/`upicks`/`drive.ids`/`filter_owner`, stale-ключи снимаются при нормализации; `hidden>0` блокирует Apply только в `multiple`, `hidden=0` на другой странице — нет.

### 7a.6. Применение выбора: лимит ID в URL, GET и валидация `from`/`param`

**Граница контракта:** лимиты ниже — **drive-специфичные**. `UserPicker` (`USER_PICKER_IDS_MAX = 500`) и его `parsePickedIds`/`togglePicked` — отдельный контракт `/users/pick` и `users.ids`: 500 ID и молчаливое усечение — его текущая локальная реализация, но не общий контракт пикеров и не переносятся в drive. Для drive действуют 100 ID, 4000 символов и явный HTTP `400` при overflow; это не общий лимит пикеров.

#### Лимиты

- `DRIVE_IDS_MAX = 200` — существующий **доменный** предел `loadDrivePage`/`normalizeIds`. Это защита сервиса, а не предел адреса и не общий `UserPicker`-лимит.
- `loadDriveList` — вход страницы и пагинатора; он не пропускает больше 100 ни из URL, ни из `overrides.ids`. 200 остаётся только нижней защитой `loadDrivePage` для прямых вызовов.
- `DRIVE_IDS_URL_MAX = 100` — предел `picked` и `drive.ids` в query. 100 UUID в `URLSearchParams` с закодированными запятыми — 3 897 символов; 200 UUID в URL не допускаем. 500 ID дали бы около 19,5 тысяч символов и превысили бы `DRIVE_IDS_URL_CHARS_MAX`, поэтому `USER_PICKER_IDS_MAX = 500` здесь не применяется.
- `DRIVE_IDS_URL_CHARS_MAX = 4000` — второй предел на сырую строку `picked`/`drive.ids`; совпадает с действующим `DRIVE_EXTRA_SEARCH.ids` (`{1,4000}`). Это предел длины, а не `500`-лимит `UserPicker`.
- `DRIVE_PICKER_FROM_MAX = 2048` — предел `from`.

`parseDriveIdsUrl(raw)` возвращает `{ ids, overflow }`:

- `null`/`undefined` — `ids = null`, `overflow = false` (ключа не было);
- пустая строка или `none` — `ids = []`, `overflow = false`;
- больше 100 валидных уникальных UUID или декодированная строка длиннее 4000 — `overflow = true`; **набор не усекается молча**.
- Дубликаты и мусор не увеличивают счётчик; `DRIVE_IDS_MAX = 200` применяется только внутри сервиса, если туда попал программный override.
- `parseDriveIdsUrl` не вызывает `parsePickedIds` и не повторяет его `break`: при 101-м валидном ID или строке > 4000 он возвращает `overflow=true`, а не обрезанный набор. Drive не наследует молчаливое усечение `UserPicker`.

#### no-JS: GET, не POST

- «Выбрать», «Выбрать эту папку», «Выбрать корень», «Применить» и «Отмена» — **GET-переходы**. Выбор только заполняет параметр вызывающей страницы; мутацией он не является.
- POST остаётся у самой операции (`move`/`copy`): пользователь возвращается на их GET-форму с `target_id`, затем отправляет форму обычным POST. Для пикера отдельный POST-route, CSRF-токен и action не нужны.
- Все выходы из пикера строят адрес от **валидированного** `initial.from` одним `applyHref`:

```ts
type DriveSelection =
  | { mode: 'single'; id: string | null }
  | { mode: 'multiple'; ids: readonly string[] }

function applyHref(selection: DriveSelection): string | null {
  if (selection.mode === 'multiple' && selection.ids.length === 0) return null // Apply недоступен
  const dest = new URL(initial.from, 'http://local.invalid')
  if (selection.mode === 'single' && selection.id === null) {
    dest.searchParams.delete(initial.param) // корень
  } else {
    const value = selection.mode === 'single' ? selection.id : selection.ids.join(',')
    dest.searchParams.set(initial.param, value)
  }
  return `${dest.pathname}${dest.search}${dest.hash}`
}
```

- «Выбрать» в `single`, «Выбрать эту папку», «Выбрать корень» и «Применить» используют этот builder; «Отмена» — сам валидированный `initial.from` без изменений.
- Остальные query-ключи `from` сохраняются; целевой `param` **заменяется** через `set` или удаляется для корня, а не дописывается вторым. Это данные вызывающей страницы, а не пикера.
- `picked`, `upicks`, `mode`, `kind`, `from`, `param`, `filter_owner` и `drive.ids` в адрес вызывающей страницы **не добавляются как самостоятельные ключи**. Если такие ключи уже были в самом `from`, они принадлежат вызывающей странице и не вычищаются. `param` используется только как имя целевого поля; `drive.ids` — ключ среза списка пикера, а не результат выбора.
- `mode=single` с явным `id:null` (корень) — `param` удаляется; пустая/невалидная строка корнем не становится; `mode=multiple`, пустой набор — `applyHref` возвращает `null`, ссылки «Применить» нет. `applyHref` не знает `hidden`/`totalItems`; компонент рендерит ссылку только при `canApplyChosen` (§7a.2a), иначе — `Alert`/`Empty` с действиями выхода (`chosen-hidden` при `hiddenCount>0`, а не пустой набор). Пустой `chosen` показывает `Empty`, но не отправляет пустой список в `from`.
- Для multiple значение `param` — `picked.join(',')`; `URLSearchParams` кодирует запятые, вызывающая страница получает обычный список. `from` — адрес возврата, `param` — имя поля, а не значения target.

#### Валидация `from` и `param`

`from`:

- только локальный путь: `localPath(from)`, без схемы, хоста и `//`; внешний адрес не проходит;
- длина не больше `DRIVE_PICKER_FROM_MAX = 2048`;
- путь не равен `/drive/pick` — пикер не может возвращать в себя;
- отсутствующий/невалидный/слишком длинный `from` нормализуется в `/drive` и в builder'е, и в `loadDrivePicker`;
- `from` считается GET-страницей; POST-only action вызывающего сюда не передаётся.

`param`:

- только `^[A-Za-z0-9_-]{1,64}$`;
- зарезервированные ключи пикера (`from`, `param`, `picked`, `upicks`, `filter_owner`, `folder`, `kind`, `mode`) и прототипные имена (`__proto__`, `constructor`, `prototype`) не принимаются;
- отсутствующий/невалидный/зарезервированный `param` нормализуется в `id`; `loadDrivePicker` возвращает уже нормализованное значение, и применение использует `initial.param`, а не сырой query;
- `param` с точкой/скобками/пробелом не проходит и не может стать произвольным именем поля.

#### `filter_owner`

- Читается отдельно от схемы фильтров: `getAll('filter_owner')` должен дать ровно `['chosen']`; значение сравнивается точно, без `true`/`1`/регистра. Иначе ключ отбрасывается (не `400`) и в канонический picker URL не попадает.
- Допустим только при `mode=multiple`; в `single` снимается вместе с `picked`/`upicks`/`drive.ids`. В `codec`, `snapshot.extra` и `from` не передаётся; `filter_owner` в `from` остаётся данными вызывающей страницы и не интерпретируется.
- `chosen → pick` ставит `filter_owner=chosen`; навигация `pick`/`chosen` сохраняет уже стоящий маркер; изменение `q`/`type`/датовых `from`/`to` в `pick` и «Сбросить фильтры» в `chosen` его снимают. Обычная пагинация и смена папки его сохраняют.
- При `pick → chosen` маркер разрешает сохранить текущие фильтры как собственные; без него унаследованные pick-фильтры сбрасываются. Это не отменяет валидацию самих фильтров: невалидный `q`/`type`/`from`/`to` отбрасывается обычной схемой независимо от маркера.

#### Превышение лимита

- **UI:** в `mode=multiple` при 100 выбранных новая отметка не добавляется; чекбокс/GET-ссылка отметки получает `aria-disabled`, счётчик показывает `100 / 100`, «Применить» доступно только по `canApplyChosen` (§7a.2a) — при пустом наборе, `hidden>0` или неизвестном `totalItems` его нет. 101-й элемент не появляется в `picked`.
- **Сервер:** `loadDrivePicker` при `picked` с `overflow`, `loadDriveList` при `drive.ids` с `overflow` (URL, `parseDriveIdsUrl`) и при `overrides.ids.length > DRIVE_IDS_MAX` (200) отвечают `400` (`drive.picked-too-long` / `drive.ids-too-long`). В этапе 0 `overrides.ids` проверяется legacy-потолком 200; URL-предел 100 и 400 появятся только с `parseDriveIdsUrl` (future), иначе прямое поведение списка изменится. Частичный список и молчаливое усечение запрещены: иначе пользователь применил бы не тот набор.
- **Builder:** `drivePickerHref` не пишет `picked`, если `parseDriveIdsUrl` дал `overflow`, и не включает `upicks=chosen`/`drive.ids` для такого набора; нормальный UI до этого не доводит. Прямой вызов с 101 ID — ошибка вызывающего, а не повод обрезать набор.
- `drive.ids=none` и пустой `chosen` под лимит не попадают: это явный пустой набор, а не overflow.

#### Проверки

- `parseDriveIdsUrl`: 100 — ок; 101 — `overflow`; 4001 символ — `overflow`; дубликаты не тратят лимит; `none` — пустой набор.
- `from`: `https://evil.example`, `//evil.example`, `/drive/pick`, строка > 2048 → `/drive`; локальный `/drive/move?...` сохраняется.
- `param`: `target_id` — ок; `bad param`, `from`, `__proto__`, `constructor` → `id`; применение идёт в `initial.param`.
- no-JS apply: GET-ссылка, остальные query `from` сохранены, `target_id` заменён; single с явным `id:null` удаляет `target_id`, пустой multiple и `hidden>0` не имеют «Применить»; `picked`/`upicks`/`mode`/`kind`/`from`/`param`/`filter_owner`/`drive.ids` не добавлены в `from`.
- `chosen`: `visiblePicked` (`totalItems` среза `drive.ids`) считается по всем страницам среза; `hiddenCount>0` блокирует Apply (`canApplyChosen`), `hiddenCount=0` на другой странице — нет; частичное скрытие даёт `list` + `Alert`, полное (`totalItems=0`) — `Empty` `chosen-hidden`.
- no-JS links: в `multiple` навигация/шаг сохраняют `picked`, `upicks` (только в `chosen`), `filter_owner` (если стоит), `mode`, `kind`, `from`, `param` и текущую папку; отметка не навигирует; current/root selection не меняет папку; «Отмена» возвращает `from` без target; пагинатор не теряет контекст; в `single` навигация сохраняет только `mode`/`kind`/`from`/`param` и текущую папку; `picked`/`upicks`/`drive.ids`/`filter_owner` не переносятся вовсе, а stale-значения снимаются.
- `filter_owner`: `chosen` — валиден; `true`/`1`/`CHOSEN`/дубль — отбрасываются без `400`; в `single` маркер снимается; `chosen→pick` пишет, изменение фильтра в `pick` и сброс фильтров в `chosen` снимают; `pick→chosen` с маркером сохраняет фильтры, без маркера — сбрасывает унаследованные; direct-URL `chosen` без маркера трактует фильтры как собственные, а невалидный маркер не обходит схему фильтров.
- 101 `picked`/`drive.ids`/override → 400, ни одной строки частичного среза; 100 — срез строится, `snapshot.extra.ids` совпадает с URL.

### 7a.7. Единый codec состояния списка: дизайн

Идея — один **чистый доменный слой** для состояния списка, а не набор `parseDriveFilters` + `driveFilterExtras` + `driveListHref` + ручных `URLSearchParams` в `fetchDrivePage`. URL-адаптер пагинатора остаётся транспортом; codec отвечает только за преобразование `DriveListState ↔ extra/query`.

#### Границы

| Что | Где живёт | Входит в codec |
|---|---|---|
| `identity`, фильтры, `ids`, `page`, `pageSize` | состояние списка | **да** |
| `picked`, `upicks`, `mode`, `step`, `kind`, `folder`, `filter_owner` | состояние пикера | нет |
| `from`, `param` | адрес возврата и имя целевого поля | нет |
| `target_id`/результат Apply | транспорт результата | нет |

Codec не знает ни про `picked`, ни про `param`: он умеет только сказать, как выглядит список и его срез. Это не даёт выбору снова протечь в `drive.ids` или в `from`.

#### Состояние

```ts
export type DriveListFilterFields = Omit<DriveListFilters, 'pageSize'>

export interface DriveListState {
  readonly identity: DriveListIdentity
  readonly filters: DriveListFilterFields
  readonly ids: readonly string[] | null // null — без среза, [] — none
  readonly page: number
  readonly pageSize: number
}

export interface DriveListDecode {
  readonly state: DriveListState
  readonly idsOverflow: boolean
}
```

`filters` не хранит `pageSize` — он ровно один раз в `state.pageSize`. `ids=null` и `ids=[]` — разные состояния; `[]` никогда не проходит через `||`/`??` и не превращается в отсутствие среза.

#### API

```ts
decodeDriveList(params: URLSearchParams, identity: DriveListIdentity): DriveListDecode
resolveDriveList(state, overrides: { ids?: readonly string[]; page?: number; pageSize?: number }): DriveListDecode
encodeDriveListExtra(state): Record<string, string>   // q, ord, type, scope, from, to, ids; без _list
encodeDriveListQuery(state): URLSearchParams           // drive, drive.size, drive.q, …
driveListHref(state: DriveListState, options?: { readonly pathnameOverride?: string }): string
driveListStateFromExtra(extra, page, pageSize, identity?): DriveListState
driveListStateFromSourceInput(input, page, pageSize): DriveListState
```

- `decodeDriveList` — единственный вход из URL. Внутри использует `readPaginatorSearch` с **URL-схемой** `DRIVE_LIST_URL_SCHEMA` для фильтров, а не второй набор `typeof raw === 'string'`. Для этапа 0 `page` и `ids` намеренно идут через legacy-адаптеры `drivePageOf`/`parseDriveIds`: дробная страница усекается, мусор → 1; `ids=null` — без среза, `ids=[]`/`none`/мусор — пустой набор, потолок `DRIVE_IDS_MAX=200`, без overflow. `drive.ids` читается из raw query и передаётся в `parseDriveIds`, а не берётся из `parsed.extra.ids`, поэтому schema не обнуляет длинный legacy-набор. `parseDriveIdsUrl`/URL-предел 100 — future после отдельной миграции; `idsOverflow` в этом пути всегда false. Предел 100 из §7a.6 остаётся ограничением picker-builder'а/`loadDrivePicker`; прямой list-URL сохраняет legacy-потолок 200, а пикер и так не пишет больше 100. `_list` в URL-схеме отсутствует, поэтому `decodeDriveList` не читает его и не может взять identity из query: identity приходит только аргументом из маршрута; случайный `_list` в URL игнорируется.
- `resolve` — единственная точка наложения `overrides.ids`: `undefined` — не переопределять, `[]` — явный `none`, `[...]` — набор. В этапе 0 проверяется legacy-потолок `DRIVE_IDS_MAX=200`; `idsOverflow` false. URL-предел 100 и overflow появятся только вместе с `parseDriveIdsUrl`, отдельно от текущего поведения.
- `encodeDriveListExtra` — только активные ключи **без `_list`**: `driveSnapshot` добавляет identity отдельным аргументом. `q/ord/type/scope/from/to` пишутся только при отличии от умолчаний; `ids=[]` → `none`, `ids=null` → ключа нет.
- `encodeDriveListQuery` — URL-проекция: `drive` только > 1, `drive.size` только ≠ 30, остальные — `drive.<key>`. Порядок стабилен, чтобы ссылки и тесты не зависели от объекта.
- `driveListStateFromExtra` — обратный вход для `fetchDrivePage` и `DriveBrowse`: из `snapshot.extra`/`filters` получается то же состояние, без ручного `text()` и без потери identity. Использует **extra-схему** `DRIVE_LIST_EXTRA_SCHEMA` и читает `_list`; `identity?` — только fallback для legacy extra без `_list`, а не источник для URL. `driveListStateFromSourceInput` добавляет к этому `q` из `SourceInput` и используется только источником.
- `driveListHref(state, options?)` — путь всегда `driveIdentityPath(state.identity)` + `encodeDriveListQuery(state)`; обязательного аргумента `pathname` нет, чтобы identity оставалась единственным источником пути. `options.pathnameOverride` — явный override только для тестов; приложение его не передаёт, компоненты не задают путь вручную. Ручных сборок `?drive…` нет.

#### Поток

```text
URL ──decodeDriveList──▶ DriveListState ──encodeDriveListExtra──▶ snapshot.extra
                              │
                              ├──resolveDriveList(overrides.ids)──▶ loadDrivePage
                              ├──encodeDriveListQuery──▶ href / preloadData
                              └──driveListStateFromExtra◀── paginator.extra

picked (multiple) ──chosenSlice──▶ ids ──resolveDriveList──▶ DriveListState
param  ──applyHref───▶ from (только Apply, не codec)
```

- `loadDriveList`: `decodeDriveList` → `resolveDriveList(state, overrides)` → `loadDrivePage` → `encodeDriveListExtra` → `driveSnapshot`. Один и тот же `ids` уходит в запрос и в снапшот.
- `fetchDrivePage`: `filters` из пагинатора → `driveListStateFromExtra` → `encodeDriveListQuery` → `preloadData`. Больше нет ручного цикла `Object.entries(filters)` с пропуском `_list`.
- `DriveBrowse`: фильтры для формы берёт из `driveListStateFromExtra`, а не из набора `text('q')`, `parseDriveIds(...)` и повторной сборки.
- `stepHref`/`chosen` в `multiple`: собирает состояние через `resolveDriveList(state, { ids: picked })` и `encodeDriveListQuery`; `picked` в codec не передаётся, в `single` этого пути нет.
- Apply (0.7) остаётся снаружи: codec не знает `from`/`param`; он лишь даёт `ids` для шага.

#### Точки подключения в приложении

Это не отдельный тестовый API: после появления codec его вызывают реальные загрузчики и компонент, иначе разделение схем остаётся мёртвым кодом.

| Реальный путь | Что вызывает codec | Что берёт из результата |
|---|---|---|
| `loadDriveList` (`load.server.ts`) | `decodeDriveList(event.url.searchParams, identity)` с `DRIVE_LIST_URL_SCHEMA`; `page`/`ids` — legacy-адаптеры `drivePageOf`/`parseDriveIds` | `state.filters` + `state.pageSize`, `state.ids`, `state.page`; identity — аргумент маршрута, `drive._list` из URL не читается. Для `driveSnapshot` — `encodeDriveListExtra(state)`, identity передаётся отдельно. |
| `fetchDrivePage` (`source.ts`) | `driveListStateFromExtra(filters, page, pageSize)` с `DRIVE_LIST_EXTRA_SCHEMA` | `state.identity` для `driveIdentityPath`, `state.filters`/`state.ids` для `encodeDriveListQuery`; `input.q` остаётся поисковым входом. Ручного цикла `Object.entries(filters)` с пропуском `_list` больше нет. |
| `DriveBrowse` | `driveListStateFromExtra(extra, snapshot?.page ?? 1, pageSize)` | `state.filters` и `state.ids` для `driveListHref`/`returnTo`; `appliedValues` остаётся только для формы и `pageSize`. Ручные `text('q')`/`parseDriveIds(...)` для среза не используются. |
| `ensureDrivePaginator`/`driveSource` | `DRIVE_EXTRA_SEARCH`/`DRIVE_EXTRAS` из `DRIVE_LIST_EXTRA_SCHEMA` | Пагинатор и `snapshot.extra` читают `_list`; URL-маршрут его не читает. |

**Сохранение поведения при подключении:**

- Единая legacy-семантика page/ids для всех трёх путей: `drivePageOf` (дробное усекается, мусор → 1) и `parseDriveIds` по raw `drive.ids`/`extra.ids` (отсутствие → `null`, `none`/пусто/мусор → `[]`, до `DRIVE_IDS_MAX=200`, без overflow).
- 400/overflow для `drive.ids` из §7a.6 — future-механизм `parseDriveIdsUrl`; в этапе 0 `loadDriveList` сохраняет legacy-усечение 200, иначе прямое поведение списка изменится.
- `loadDriveList` получает эти значения из `decodeDriveList`; `fetchDrivePage` — из `driveListStateFromExtra`; `DriveBrowse` — оттуда же. Второго парсера page/ids в этих путях нет.
- `fetchDrivePage` передаёт только активные ключи; `input.q` не теряется, `_list` не попадает в query, `drive.ids` пишется как `none`/список, а не пустой строкой.
- `DriveBrowse` сохраняет прежние значения `appliedValues` для формы и `pageSize`; состояние из extra не подменяет форму, а даёт тот же срез для ссылок и `returnTo`.
- Ошибки/неизвестный `total` не превращаются в пустой срез; codec не вызывает `Apply` и не меняет `picked`/`param`.

#### Схемы URL и extra

- Кодек — отдельный чистый модуль `src/modules/drive/list-codec.ts` без Svelte/server-only импортов; `source.ts` реэкспортирует схемы и функции, `load.server.ts` — единственный серверный потребитель.
- **`DRIVE_LIST_URL_SCHEMA`** (на базе `extraField`) — только `q/ord/type/scope/from/to/ids`; `_list` в ней нет. Это схема `decodeDriveList` и URL-фильтров. Случайный `_list` в query не является частью состояния и не переопределяет identity маршрута.
- **`DRIVE_LIST_EXTRA_SCHEMA`** — `DRIVE_LIST_URL_SCHEMA` + внутренний `[DRIVE_IDENTITY_KEY]: _list`. Это схема `snapshot.extra`/`paginator.extra` и `driveListStateFromExtra`; наружу в URL она не проецируется.
- Обе схемы собираются из одного `DRIVE_LIST_PUBLIC_FIELDS`: валидаторы `q/ord/type/scope/from/to/ids` объявлены один раз. `DRIVE_LIST_EXTRA_SCHEMA` добавляет только `_list`; второго списка валидаторов нет. Старое имя `DRIVE_LIST_SCHEMA` не используется.
- `DRIVE_EXTRA_SEARCH` и `DRIVE_EXTRAS` выводятся из `DRIVE_LIST_EXTRA_SCHEMA` (paginator хранит identity в `_list`); `decodeDriveList` обязан брать `DRIVE_LIST_URL_SCHEMA`, а не extra-схему.

```ts
const DRIVE_LIST_PUBLIC_FIELDS = {
  q: extraField('text', (v) => typeof v === 'string' && v.length <= 255),
  ord: extraField('text', (v) => v === 'name' || v === 'updated' || v === 'size'),
  type: extraField('text', (v) => v === 'all' || v === 'file' || v === 'folder'),
  scope: extraField('text', (v) => v === 'folder' || v === 'global'),
  from: extraField('text', (v) => typeof v === 'string' && v.length <= 10),
  to: extraField('text', (v) => typeof v === 'string' && v.length <= 10),
  ids: extraField('text', (v) => typeof v === 'string' && (v === DRIVE_IDS_NONE || /^[0-9a-f,-]{1,4000}$/i.test(v))),
} satisfies ExtraSearchSpec

export const DRIVE_LIST_URL_SCHEMA: ExtraSearchSpec = { ...DRIVE_LIST_PUBLIC_FIELDS }

export const DRIVE_LIST_EXTRA_SCHEMA: ExtraSearchSpec = {
  [DRIVE_IDENTITY_KEY]: extraField('text', (v) => typeof v === 'string' && v.length <= 64),
  ...DRIVE_LIST_URL_SCHEMA,
}
```

- `decodeDriveList(params, identity)` вызывает `readPaginatorSearch(params, DRIVE_LIST_URL_SCHEMA)` и передаёт `identity` явно; `params.get('_list')` не читается. `driveListStateFromExtra(extra, page, pageSize, identity?)` вызывает `readPaginatorSearch(extra, DRIVE_LIST_EXTRA_SCHEMA)` и берёт identity из `_list`; `identity?` используется только если `_list` отсутствует (legacy snapshot), иначе identity из extra авторитетна.
- `driveFilterExtras` и `driveListHref` остаются экспортами для совместимости, но становятся тонкими обёртками codec; новые вызовы идут через codec.
- `_list` остаётся внутренним: в URL не пишется, в `snapshot.extra` — да; `encodeDriveListExtra` его не добавляет, `driveSnapshot` кладёт identity сам. `DRIVE_LIST_URL_SCHEMA` не должна использоваться для чтения `snapshot.extra`; `DRIVE_LIST_EXTRA_SCHEMA` не должна использоваться для URL.
- `ids=[]` → `none` в extra и query; `ids=null` → ключа нет; `overrides.ids=[]` не заменяется на `undefined`.
- `picked`/`param`/`apply` не входят в `DriveListState`; это отдельные типы/функции пикера.

#### Проверки

- Round-trip: `decodeDriveList(encodeDriveListQuery(state), identity)` для root/folder/trash/starred; фильтры, страница, размер, `ids`.
- `ids=null` — ключа нет; `ids=[]` — `drive.ids=none`; `parseDriveIds` читает raw `drive.ids`/`extra.ids` до `DRIVE_IDS_MAX=200`, 201-й ID отбрасывается без overflow; `none`/пусто/мусор — `[]`; `overrides.ids=[]` остаётся `none`.
- `page`: отсутствует/`1` → 1, `2.7` → 2, `0`/мусор → 1; это legacy-контракт `loadDriveList`, а не `readPaginatorSearch.page`. `driveListStateFromExtra` получает page/pageSize аргументами и не перечитывает их из extra.
- `decodeDriveList` и `driveListStateFromExtra` используют один и тот же `parseDriveIds`; `drive.ids` из URL и `ids` из extra дают одинаковый набор/null-срез, различается только источник.
- Умолчания не пишутся: page 1, size 30, sort name, type all, scope folder, пустые даты.
- `snapshot.extra` и `encodeDriveListExtra(state)` следующей страницы дают одинаковый набор `ids`; identity из `_list` на `ids` не влияет, `picked` не влияет на codec.
- `driveListHref(state)` выводит путь из `state.identity` (root/folder/trash/starred) и не требует `pathname`; `pathnameOverride` используется только в тестах и не меняет identity/query. `driveListHref`/`stepHref`/`fetchDrivePage` не содержат ручных `drive.*`; `grep` по ним — только codec.
- `driveSnapshot.extra` не содержит `_list` дважды; identity совпадает с `state.identity`.
- **URL vs extra:** `DRIVE_LIST_URL_SCHEMA` не содержит `_list`, `DRIVE_LIST_EXTRA_SCHEMA` содержит; `encodeDriveListExtra` не пишет `_list`.
- `decodeDriveList(new URLSearchParams({ _list: 'trash' }), { kind: 'root' })` даёт root: `_list` из URL не читается и не переопределяет identity маршрута.
- `driveListStateFromExtra({ _list: 'trash' }, ...)` даёт trash; при отсутствии `_list` используется переданный `identity` fallback; extra-схема не подменяется URL-схемой.
- `decodeDriveList` не использует `DRIVE_LIST_EXTRA_SCHEMA`; `driveListStateFromExtra` не использует `DRIVE_LIST_URL_SCHEMA`; `DRIVE_EXTRA_SEARCH`/`DRIVE_EXTRAS` собраны из extra-схемы.

### 7a.8. Защита от устаревших ответов

Защита не должна быть вторым счётчиком запросов поверх пагинатора. В ядре уже есть механика, её надо использовать и дополнить только тем, чего не хватает drive-источнику.

#### Что уже гарантирует ядро

- `fetchReplace` и `loadMore` увеличивают `reqId`, отменяют предыдущий `AbortController` и не пишут результат/ошибку/`progress`, если `reqId` уже другой.
- `replacePaginatorSnapshot` и `reset` отменяют replace и очищают prefetch; `dropPrefetched` увеличивает `prefetchGen` и абортит полётные prefetch-запросы.
- `rehydratePaginator` принимает новый снапшот только при совпадении extra/page/pageSize; длинная лента и живой срез не затираются старым снимком.
- `Listing` при собственном `preloadData` уже сравнивает токен `asked`.

**Не делать:** свой `requestId` в URL, `setTimeout`-угадывание, «последний пришедший ответ» и ручной сброс `loading` из источника. Это дублирует ядро и даёт два источника истины.

#### Чего не хватает drive

`fetchDrivePage` сейчас:

- не принимает `AbortSignal` и не пробрасывает `look.signal` — `preloadData` нельзя отменить, но проверять отмену до и после ожидания обязательно;
- не проверяет, что `snapshot` относится к запрошенному `DriveListState`: поздно пришедший ответ или ответ не с тем `extra`/page может быть принят, если ядро уже не видит разницы;
- смешивает `redirect` с `auth.expired`, хотя это разные исходы;
- не умеет отличить «пустую страницу» от «ответ не для этого запроса».

#### Ключ запроса

Ключ — канонический путь списка из codec §7a.7, а не отдельный счётчик:

```ts
driveListKey(state) =
  `${driveIdentityPath(state.identity)}?${encodeDriveListQuery(state)}`
```

- В ключ входят identity, все активные фильтры, `ids`, `page` и `pageSize`.
- Ключ не содержит `picked`, `upicks`, `mode`, `from`, `param`, `filter_owner`: это не состояние списка.
- `ids=null` и `ids=[]` дают разные ключи (`none` против отсутствия).
- `driveListKeyFromSnapshot(snapshot)` строится через `driveListStateFromExtra(...)` и тот же `encodeDriveListQuery`; второго формата ключа нет.
- Ключ — **проверка принадлежности**, а не замена `reqId`: гонку отменяет ядро, ключ ловит нарушение контракта (чужой/закешированный снапшот).

#### `fetchDrivePage`

```ts
async function fetchDrivePage(page, pageSize, input, signal) {
  const state = driveListStateFromSourceInput(input, page, pageSize)
  const expected = driveListKey(state)
  if (signal?.aborted) throw abortError()

  const result = await preloadData(expected) // preloadData не умеет abort

  if (signal?.aborted) throw abortError()
  if (result.type !== 'loaded') throw loadError(result)
  const snapshot = result.data.snapshot
  if (!snapshot) throw loadError(result)
  if (driveListKeyFromSnapshot(snapshot) !== expected) {
    throw staleListError('drive.list-stale')
  }
  return pageOf(snapshot, page)
}
```

- `driveSource.data` передаёт `look.signal` в `fetchDrivePage`; сигнал не теряется на границе источника.
- `abortError()` — `DOMException`/`Error` с `name = 'AbortError'`: ядро молча игнорирует отменённый ответ.
- `staleListError` — ошибка с `code = 'drive.list-stale'`: если запрос всё ещё текущий, UI показывает retry, а не чужие данные; если он уже устарел, ядро отбросит ошибку по `reqId`.
- `preloadData` не отменяется: до и после `await` проверяется только сигнал; `Promise.race` не используется, потому что он не останавливает сеть и создаёт ложное чувство отмены.
- «Пустая страница» — это валидный ответ с тем же ключом; «ответ другого ключа» — ошибка, а не пустой массив.

#### Снапшоты и гидратация

- `loadDriveList` отдаёт снапшот, построенный из того же `DriveListState`; `extra`, `page` и `pageSize` не собираются повторно после override.
- `rehydratePaginator` уже не принимает снимок с другим extra/page/pageSize; drive не обходит его прямым `store.hydrate`.
- Старый снимок с тем же ключом допустим: это обновление данных того же запроса, а не гонка. Старый снимок с другим ключом не применяется.
- Смена identity/filter/ids/page идёт через `replacePaginatorSnapshot`/`setExtra`/`goToPage`, то есть с bump `reqId` и отменой prefetch; не через локальную замену `snapshot`.

#### Picker и callbacks

- No-JS переходы пикера — обычная GET-навигация; устаревшего JS-ответа там нет.
- JS-модалка: `DriveTargetPicked.seq` — **монотонный счётчик канала**, а не `Date.now()`; `DriveMove`/`DriveCopy` применяют только payload с ожидаемым `seq`/каналом, `mode==='single'` и **без `ids`**, где `id` — UUID или явный `null`. `mode=multiple`/любое `ids`/отсутствующий или неверный `mode` игнорируются; невалидный/отсутствующий `id` не становится корнем и не очищает `target_id`.
- Закрытый/переоткрытый пикер не должен применить старый callback: новый экземпляр начинает новую последовательность, старый payload отбрасывается.
- В `multiple` `picked`/`step` меняются навигацией или локально в модалке, а не фоновым ответом списка; list codec в них не вмешивается. В `single` этих полей нет.

#### Проверки

- Два запроса A/B: B стартует позже, A отвечает позже — в store только B; A не пишет ни данных, ни ошибки, ни `progress`.
- `signal` уже aborted до вызова — `preloadData` не вызывается; abort во время ожидания — результат не применяется.
- `fetchDrivePage` получает `look.signal`; prefetch после смены фильтра не попадает в буфер.
- Снапшот с другим `identity`/`ids`/page/pageSize даёт `drive.list-stale`, а не подменяет страницу; retry после ошибки работает.
- `redirect` не превращается в `auth.expired`; пустая валидная страница не считается stale.
- `rehydratePaginator`: старый снимок с другим ключом не затирает живой срез; с тем же ключом — обновляет.
- Picker: два callback подряд применяют только последний; payload с `mode=multiple`, любым `ids`, отсутствующим/неверным `mode` или невалидным `id` не меняет move/copy `target_id`; `id:null` принимается только в явном `mode=single` без `ids`.

### 7a.9. Ревизия выбора после мутаций

`picked` — это **намерение пользователя**, а не список строк, которые случайно оказались на текущей странице. Отсутствие ID на текущей странице, в фильтре или в другом folder-срезе — **не доказательство удаления**. Ревизия выполняется только по подтверждённому результату мутации или явной серверной проверке.

#### Этап 0: реальные сценарии

В этапе 0 **нет операции, которая мутирует `picked`**: пикер только собирает набор, а move/copy получают одну цель. Поэтому здесь нет «ревизии после групповой мутации»; есть только отображение среза `chosen` и блокировка Apply по `hidden`/пустому набору/неизвестному `total` — без per-ID проверки выбранных ID.

| Сценарий этапа 0 | Поведение |
|---|---|
| Внешнее переименование или перемещение выбранного узла | ID стабилен: сохранить выбор; label/путь обновятся при следующей загрузке. Не удалять ID из-за смены имени или папки. |
| Внешнее удаление/корзина/потеря доступа к выбранному узлу | Локально не угадывать и не чистить `picked` по отсутствию в списке. Для цели move/copy сервер отвечает `not-found`/`forbidden`; выбор по странице не ревизуется. |
| Выбранная цель move/copy переименована или перемещена | ID цели тот же, цель остаётся валидной; обновить label, если он пришёл с сервера. |
| Выбранная цель move/copy удалена, в корзине или недоступна | Цель невалидна: ошибка и повторный выбор. **Не** подставлять корень вместо неё. |
| Переход по папкам, страницам или фильтрам | Выбор не менять; отсутствие на одной странице не считается удалением. |
| Закрытие/переоткрытие JS-пикера | Старый callback не применять: монотонный `seq`/канал; move/copy — только single-guard §7a.2a (`mode:'single'`, без `ids`, UUID или явный `id:null`). |
| Успешная операция с обычного списка | `picked` в ней не участвует; ревизия выбора не требуется. |

- `drive.ids` в этапе 0 — производное от всего `picked` для шага `chosen`; пустой набор — `none`, а не отсутствие ключа. Пересечение с текущей папкой/фильтром считает `loadDriveList` и отражает в `total`/`hidden`; сам `drive.ids` не укорачивается до видимых строк.
- Если выбранный набор пуст (`picked=[]`), показывается `empty-chosen` из §7a.10, Apply недоступен; полный список не возвращается. Пустая страница при `picked≠[]`, подтверждённом `hiddenCount=0` и `page>1` — это `empty-page`, а не пустой выбор; Apply блокируется через `canApplyChosen` (неизвестный/некорректный `totalItems`, `hiddenCount>0`), а не из-за пустой страницы; пустой набор — отдельный случай `empty-chosen`.
- В этапе 0 отсутствие ID на странице не доказывает удаление, и `picked` не чистится. Per-ID-проверки набора на Apply нет: удаление или потерю доступа в будущем подтверждает per-ID outcome либо manifest ACL, а не текущий `hidden`.

#### Проверки этапа 0

- Цель move/copy: rename/move — валидна; delete/trash/no-access — ошибка, без fallback на корень.
- Внешнее исчезновение выбранного ID: `picked` не чистится по странице. Per-ID проверки на Apply нет. При `hiddenCount>0` или неизвестном/некорректном `totalItems` Apply disabled по `canApplyChosen` (состояние `chosen-hidden`); при подтверждённом `hiddenCount=0` это обычный GET с `param`, а отсутствие/доступ к ID проявляется у получателя — это не ревизия выбора.
- При `hiddenCount>0` или неизвестном/некорректном `totalItems` Apply disabled, а не «ошибка Apply»; при `hiddenCount=0` Apply не делает per-ID проверку набора.
- Навигация и фильтры не меняют `picked`.
- Два picker-callback подряд применяют только последний; payload `multiple`/любое `ids`/missing или wrong `mode`/невалидный или отсутствующий `id` не меняет `target_id`; только явный `mode:'single'` + `id:null` даёт корень.

#### Future: групповые операции

Этот раздел **не входит в этап 0** и нужен только когда появится действие над `picked` (удалить/переместить/скопировать/восстановить/выдать доступ набором).

##### Per-ID контракт ответа

```ts
export type DriveBulkOperation =
  | 'trash' | 'purge' | 'restore'
  | 'move' | 'copy' | 'rename'
  | 'star' | 'share' | 'unshare'

export interface DriveBulkNodeState {
  readonly id: string
  readonly label: string
  readonly parentId: string | null
  readonly trashed: boolean
  readonly starred: boolean
}

export interface DriveBulkItemResult {
  readonly id: string
  readonly status: 'ok' | 'failed'
  /** false — операция была no-op (уже в целевом состоянии). */
  readonly changed: boolean
  /** Только для failed: можно повторить без изменения набора. */
  readonly retryable?: boolean
  /** Стабильный код доменной причины; текст UI берёт из `driveMessage`. */
  readonly code?: string
  readonly params?: Readonly<Record<string, unknown>>
  /** Состояние после операции; null — узла больше нет/он недоступен. */
  readonly post: DriveBulkNodeState | null
  /** Потомки, удалённые вместе с узлом (trash/purge). */
  readonly removedIds?: readonly string[]
}

export interface DriveBulkOutcome {
  readonly operation: DriveBulkOperation
  readonly requested: number
  readonly results: readonly DriveBulkItemResult[]
  readonly succeeded: number
  readonly changed: number
  readonly failed: number
  readonly removed: number
}
```

##### Маппинг `DriveBulkOperation → DriveOperationName`

`DriveBulkOperation` — имя будущей групповой операции; `DriveOperationName` — текущая матрица операций (`operations.ts`). Это разные пространства имён: bulk `trash` не равен route `trash-action`, а `mkdir`/`upload`/`dav-*` вообще не являются bulk-операциями.

```ts
export type DriveBulkableOperationName = Exclude<
  DriveOperationName,
  'mkdir' | 'upload' | 'dav-issue' | 'dav-revoke'
>

export const DRIVE_BULK_OPERATION_TO_NAME = {
  trash: 'trash-action',
  purge: 'purge',
  restore: 'restore',
  move: 'move',
  copy: 'copy',
  rename: 'rename',
  star: 'star',
  share: 'share',
  unshare: 'unshare',
} as const satisfies Record<DriveBulkOperation, DriveBulkableOperationName>

export const DRIVE_OPERATION_TO_BULK = {
  'trash-action': 'trash',
  purge: 'purge',
  restore: 'restore',
  move: 'move',
  copy: 'copy',
  rename: 'rename',
  star: 'star',
  share: 'share',
  unshare: 'unshare',
} as const satisfies Record<DriveBulkableOperationName, DriveBulkOperation>
```

| `DriveBulkOperation` | `DriveOperationName` | Маршрут |
|---|---|---|
| `trash` | `trash-action` | `/drive/trash-action` |
| `purge` | `purge` | `/drive/purge` |
| `restore` | `restore` | `/drive/restore` |
| `move` | `move` | `/drive/move` |
| `copy` | `copy` | `/drive/copy` |
| `rename` | `rename` | `/drive/rename` |
| `star` | `star` | `/drive/star` |
| `share` | `share` | `/drive/share` |
| `unshare` | `unshare` | `/drive/unshare` |

- Единственное переименование — `trash` → `trash-action`; остальные bulk-имена совпадают с `DriveOperationName`. Обратное преобразование `trash-action → trash` обязательно, иначе outcome/UI начнут путать route с именем операции.
- Обе таблицы полные: `Record<DriveBulkOperation, DriveBulkableOperationName>` и `Record<DriveBulkableOperationName, DriveBulkOperation>` не дают забыть ветку. UI не подставляет `trash-action` строкой и не угадывает операцию по URL: вызывает `driveOperationHref(DRIVE_BULK_OPERATION_TO_NAME[op])`.
- `DriveBulkOutcome.operation` остаётся bulk-именем (`trash`); маппинг применяется только на границе вызова текущей операции/формы/модалки, а не переписывает outcome.
- **Исключены из bulk:** `mkdir` и `upload` — создают новый узел/байты и не работают с набором выбранных ID; `dav-issue`/`dav-revoke` — управляют токенами WebDAV, а не узлами диска. `DriveBulkableOperationName` и обе таблицы не содержат этих ключей; `DriveOperationName` может их содержать, но UI не должен строить bulk из произвольного имени операции.

##### Адаптер `DriveNodeView → DriveBulkNodeState`

Адаптер — чистый и без прав: он проецирует уже авторитетный узел, а не догадывается о правах или состоянии.

```ts
export function driveBulkNodeStateOf(
  node: DriveNodeView | null | undefined,
): DriveBulkNodeState | null {
  if (!node) return null
  return {
    id: node.id,
    label: node.name,
    parentId: node.parentId,
    trashed: node.trashedAt !== null,
    starred: node.starred,
  }
}
```

- `label = name` (не путь и не вычисленный заголовок), `trashed = trashedAt !== null`, `starred` — как у узла; `parentId` — фактический родитель после операции.
- Вход `null`/`undefined` даёт `post: null`, а не синтетический узел `{ id }` и не «корень».
- `DriveEntry` содержит узел: вызывать `driveBulkNodeStateOf(entry.node)`; `caps`, `size`, `fileId` в `DriveBulkNodeState` не входят.
- Адаптер не читает БД и не решает ACL: узел уже должен быть получен сервисом после мутации.

##### Сервисный результат

Сервис отдаёт per-ID результат до транспортной проекции; форма и UI не должны получать `Record<string, unknown>`.

```ts
export interface DriveBulkServiceItem {
  readonly id: string
  readonly status: 'ok' | 'failed'
  readonly changed: boolean
  readonly retryable?: boolean
  readonly code?: string
  readonly params?: Readonly<Record<string, unknown>>
  /** Авторитетное состояние после операции; null — узла нет/нет доступа. */
  readonly post: DriveNodeView | null
  /** Удалённые потомки, подтверждённые этой же операцией. */
  readonly removedIds?: readonly string[]
}

export interface DriveBulkServiceValue {
  readonly operation: DriveBulkOperation
  readonly items: readonly DriveBulkServiceItem[]
}

export type DriveBulkServiceResult = DriveResult<DriveBulkServiceValue>
```

```ts
export function driveBulkItemOf(item: DriveBulkServiceItem): DriveBulkItemResult {
  return {
    id: item.id,
    status: item.status,
    changed: item.changed,
    ...(item.retryable !== undefined ? { retryable: item.retryable } : {}),
    ...(item.code !== undefined ? { code: item.code } : {}),
    ...(item.params !== undefined ? { params: item.params } : {}),
    post: driveBulkNodeStateOf(item.post),
    ...(item.removedIds?.length
      ? { removedIds: [...new Set(item.removedIds)] }
      : {}),
  }
}

export function driveBulkOutcomeOf(value: DriveBulkServiceValue): DriveBulkOutcome {
  const results = value.items.map(driveBulkItemOf)
  const removed = new Set(results.flatMap((r) => r.removedIds ?? []))
  return {
    operation: value.operation,
    requested: results.length,
    results,
    succeeded: results.filter((r) => r.status === 'ok').length,
    changed: results.filter((r) => r.changed).length,
    failed: results.filter((r) => r.status === 'failed').length,
    removed: removed.size,
  }
}
```

- `DriveBulkServiceResult` — обычный `DriveResult<DriveBulkServiceValue>`: `{ ok:true, value }` или `{ ok:false, code, params? }`. `ok:false` — отказ всей операции до выполнения; per-ID ошибки остаются в `items`; частичный успех — `ok:true`.
- `DriveBulkServiceItem` — ровно один на уникальный запрошенный ID. `status:'failed'` не делает весь `DriveResult` ошибкой; `retryable`/`code`/`params` живут на элементе.
- `changed` вычисляется по подтверждённому до/после: no-op даёт `false`, а не ошибку. `post` читается после мутации из БД (в той же транзакции/после commit) и передаётся в адаптер; `null` — узел удалён или недоступен.
- `removedIds` содержит только подтверждённые удалённые потомки, без дублей; `DriveBulkOutcome.removed` — размер объединения, а не число строк. `post`/`removedIds` не синтезируются из запроса.
- Транспортный `DriveBulkOutcome` собирается `driveBulkOutcomeOf`; количество `requested/succeeded/changed/failed` выводится из `items`, а не задаётся вручную. `submissionId` в сервисный результат не входит — корреляция остаётся form-level.

##### Инварианты `DriveBulkOutcome`

- `results` — ровно по одному элементу на каждый уникальный запрошенный ID, в порядке первого входа; дубликаты схлопываются **до** операции. Неизвестный UUID — `failed` с `post:null`, а не выпавшая строка. Потомки, удалённые как side effect, своих строк не получают, если не были запрошены.
- `requested` — число уникальных ID; `results.length === requested`, `succeeded + failed === requested`, `changed <= succeeded`. `post` — авторитетное состояние после операции, а не догадка UI. `null` значит «нет/недоступен»; `parentId` и `label` нужны для переноса/переименования.
- `removedIds` — объединение всех удалённых потомков (включая выбранных); клиент применяет его как множество, даже если потомок не имел своей строки результата. `removed` — размер этого объединения, а не число строк `results`.
- `code`/`params` — только стабильные коды, без готовых фраз и без текста исключений. `changed:false` — валидный no-op, не ошибка.
- Пустой набор, мусорный UUID, больше `DRIVE_IDS_MAX` (200) ID и отсутствие права на саму операцию — **отказ до операции**, без `results` и без частичной ревизии. UI-предел `picked`/`drive.ids` в URL остаётся 100, поэтому группа из пикера больше 100 не соберётся; сервер не усекает набор молча. Частичный исход — HTTP 200 + `DriveBulkOutcome`; per-ID ошибки не подменяют form-level `Result.errors`.
- Корреляция — form-level `Result.submissionId`; `operation` в ответе должен совпасть с операцией текущей формы. Старый/чужой `submissionId` или другая операция не ревизуют `picked`.
- Повтор с тем же `submissionId` идемпотентен: тот же `DriveBulkOutcome`, ревизия не должна применяться дважды.

##### Как ревизуется `picked`

Перед отправкой запоминается `submitted = picked.slice()`. Ответ ревизует именно `submitted`, а не набор, который пользователь успел изменить во время запроса. `view` — текущий носитель: `trash`, `starred` или обычный live (`root`/`folder`); фильтр/поиск носителем не считается.

```ts
const drop = new Set<string>()
for (const r of outcome.results) {
  for (const id of r.removedIds ?? []) drop.add(id)
  if (r.status === 'failed' && r.retryable) continue
  if (!r.post) { drop.add(r.id); continue }
  if (r.post.trashed !== (view === 'trash')) drop.add(r.id)
  if (view === 'starred' && !r.post.starred) drop.add(r.id)
}
const revised = submitted.filter((id) => !drop.has(id))
const added = picked.filter((id) => !submitted.includes(id))
picked = [...revised, ...added]
```

`post.label` обновляет подпись в `DriveTargetPicked.labels`; сам `picked` остаётся списком ID. Если хост не хранит labels отдельно, после ревизии он перечитывает видимые строки, но не меняет состав `picked`.

**Выход из текущей папки или фильтра — не удаление.** После успешного `move` (в другую папку) или `rename` (переставшего совпадать с фильтром) ID остаётся в `picked`: это намерение пользователя, а не свойство текущего среза. Меняются только `post.parentId`/`post.label`; `drive.ids` для `chosen` остаётся `picked.join(',')` (или `none`), а не урезается до `total`/текущей папки. Поэтому `total` среза может уменьшиться, `hidden = picked.length - total` стать больше нуля, и `Apply` заблокируется как состояние `chosen-hidden` (`list` + `Alert` при видимых строках, `Empty` только при `total=0`); ID всё равно не удаляется и снова станет видимым при переходе в новую папку или снятии фильтра. Удалять его может только явное действие пользователя или подтверждённый `post:null`/`removedIds`.

| Операция | `post` после успеха | Ревизия |
|---|---|---|
| `trash` | `trashed:true` или `null` | убрать из live/`starred`; в корзине остаётся |
| `purge` | `null` | убрать всегда |
| `restore` | `trashed:false` | убрать из `trash`; в live остаётся |
| `move` | `parentId` новый, возможно вне текущей папки | оставить ID, обновить `parentId`/путь; `drive.ids` не сокращать; в `chosen` это `hidden`, а не удаление |
| `rename` | `label` новый, возможно вне текущего фильтра | оставить ID, обновить label; `drive.ids` не сокращать; в `chosen` это `hidden`, а не удаление |
| `copy` | source-узел живой | оставить source; копии не добавлять |
| `star` | `starred` новый | в `starred` убрать при `false`, в live оставить |
| `share`/`unshare` | узел доступен или `null` | оставить при `post`, убрать при `null` |

- `failed + retryable` — ID остаётся в наборе, даже если `post` неизвестен; ошибка показывается, повтор разрешён.
- `failed` без `retryable` и `post:null` — подтверждённое `not-found/forbidden`; ID убирается. `failed` с живым `post` (например, конфликт имени) — остаётся.
- `ok + post:null` — узел удалён/недоступен; ID убирается. `ok` с `post` — ID остаётся; label/`parentId` обновляются, даже если узел ушёл из текущего фильтра или папки.
- `post.trashed !== (view==='trash')` и `view==='starred' && !post.starred` — узел вышел из текущего носителя; ID убирается. Перемещение/переименование из носителя не выводит.
- `removedIds` убирает выбранных потомков независимо от их собственного статуса; повторное применение того же outcome идемпотентно.
- ID из `submitted`, которого нет в `results`, **не удаляется**; это нарушение контракта, которое нужно показать, а не молча почистить.
- ID, добавленные после отправки, сохраняются: `added` не входит в `submitted` и не может быть удалён старым ответом. Ревизия применяется только при совпадении `submissionId` и `operation`; иначе ответ игнорируется.
- `copy` не добавляет новые ID в `picked`; source-узлы остаются, если `post` живой.

- **Корзина/purge/восстановление:** успешное удаление или purge убирает ID и выбранных потомков; restore автоматически не выбирает обратно. Терминальная ошибка (`post:null`, без `retryable`) тоже убирает ID; retryable/конфликтная — оставляет для повтора.
- **Перемещение/переименование набора:** ID стабильны — сохранить выбор; обновить label/путь. Перемещение родителя не удаляет выбранного ребёнка.
- **Копирование:** новые ID не добавлять в набор автоматически.
- **ACL/шара:** убирать ID только при `failed` без `retryable`/`post:null` или `ok+post:null`; сетевую ошибку не трактовать как потерю доступа.
- **Частичный успех:** подтверждённые `ok`/`post` и терминальный `failed+post:null` меняют набор; `retryable`/конфликтные `failed` остаются. Без per-ID контракта частичный успех не симулируется.
- **Ошибка мутации:** выбор не менять; операция не должна оптимистично вычищать набор.
- После ревизии `drive.ids` пересобирается **из всего `picked`** в порядке первого выбора, а не из `total`/видимых строк текущей папки или фильтра; перемещённый за пределы среза ID остаётся в строке. Пустой набор — `none`, `chosen` — `Empty`, Apply недоступен; непустой набор с `hidden>0` остаётся состоянием `chosen-hidden` (`list` + `Alert`, `Empty` только при `total=0`) с полным `drive.ids`.
- Если выбранный узел исчез на шаге `chosen`, не подменять его первой/последней строкой и не делать вид, что набор прежний.

##### Обязательные сценарии ревизии

Ниже — минимальный набор тестов на правило выше; `submitted` фиксируется до ответа, `added` — после.

| # | Сценарий | Вход | Ожидание |
|---|---|---|---|
| 1 | Rename успешен | `submitted=[A,B]`, `view=live`; A: `ok`, `changed:true`, `post.label=A2`; B: `ok` | `picked=[A,B]`; labels A2/B; порядок и `drive.ids` не меняются; ничего не удалено |
| 2 | Rename вне текущего фильтра | `submitted=[A]`, `view=live`; A: `ok`, `post.label=A2`; фильтр больше не совпадает | A остаётся, label A2; `drive.ids` содержит A; если `chosen` скрывает его фильтром — `hidden>0`/Apply disabled, но ID не удаляется |
| 3 | Move успешен | `submitted=[A]`, `view=folder:F0`; A: `ok`, `post.parentId=F1` | A остаётся, `parentId=F1`; `drive.ids` по-прежнему содержит A; уход из F0 даёт `hidden`, а не удаление |
| 4 | Trash из live | `submitted=[A,B]`, `view=live`; A/B: `ok`, `post.trashed=true` | A/B удалены; `removedIds` удаляет потомков; `drive.ids` пересобран (`none`, если набор пуст) |
| 5 | Trash в корзине | `submitted=[A]`, `view=trash`; A: `ok`, `post.trashed=true` | A остаётся: уже в текущем carrier; ложного удаления нет |
| 6 | Retryable per-ID error | `submitted=[A,B]`; A: `failed`, `retryable:true`, `post:null`; B: `ok` | A остаётся, B ревизуется по outcome; ошибка/retry, без частичного удаления A |
| 7 | Terminal per-ID error | `submitted=[A,B]`; A: `failed`, `retryable:false`, `post:null`; B: `ok` | A удалён, B остаётся; ошибка относится к A |
| 8 | Conflict/live error | `submitted=[A]`; A: `failed`, `retryable:false`, `post` живой | A остаётся; ошибка показывается, ID не удаляется |
| 9 | Aggregate error | `DriveBulkServiceResult ok:false`, outcome нет | `picked` не меняется, ревизии нет, оптимистичной чистки нет |
| 10 | Внешнее удаление | `submitted=[A,B]`; A исчез из страницы; outcome: A `failed`, `post:null`, B `ok` | A удаляется только по подтверждённому `post:null`; если A вообще нет в `results`, не удалять и показать нарушение контракта |
| 11 | Внешнее rename/move | `submitted=[A]`, `view=live`; A внешне переименован/перемещён; outcome: A `ok`, новые `post.label`/`post.parentId` | A остаётся, label/parent обновлены; смена фильтра/папки не удаляет ID |
| 12 | Добавление после submit | `submitted=[A,B]`, после отправки добавлен C; outcome для A/B | C сохраняется; A/B ревизуются по outcome; `added` не входит в `submitted` |

#### Future-проверки

- Маппинг: `DRIVE_BULK_OPERATION_TO_NAME` покрывает все `DriveBulkOperation`; `trash` даёт ровно `trash-action`, остальные — одноимённые `DriveOperationName`; `DRIVE_OPERATION_TO_BULK` покрывает ровно `DriveBulkableOperationName`; `mkdir`/`upload`/`dav-issue`/`dav-revoke` отсутствуют в обеих таблицах и не проходят в bulk; `DriveBulkOutcome.operation` не переписывается route-именем.
- Проверка IDs набора перед групповой мутацией — future: существование, ACL, скрытые/недоступные ID проверяет сервер; в этапе 0 multiple-набор не мутируется и такая проверка не выполняется.
- Trash/purge/restore набора: успешные/неуспешные ID, пустой `chosen` после ревизии; `removedIds` убирает потомков.
- Move/rename набора: ID сохраняются, label/`parentId` обновляются; уход из текущей папки не удаляет ID.
- ACL: `post:null` без `retryable` убирает ID, network error с `retryable` — нет.
- Partial success: `results` в порядке входа, `succeeded/changed/failed/removed` совпадают с элементами (`succeeded+failed=requested`); только подтверждённые ID меняются.
- `failed` без `retryable` + `post:null` убирает; `failed` с живым `post` остаётся; `retryable` всегда остаётся.
- `removedIds` сильнее статуса отдельного потомка; повтор того же outcome идемпотентен.
- ID, отсутствующий в `results`, не удаляется; `added` после submit сохраняется; старый `submissionId` не применяется.
- Пустой/201 ID — отказ до операции, `results` нет; 100 ID из URL и 200 из программного вызова не усекаются молча; частичный исход — 200 + outcome, без `Result.errors` на каждый ID.
- `submissionId`/`operation` не совпали — ответ не ревизует набор; `requested`/`results.length`/counts сходятся.
- **Адаптер:** `DriveNodeView` даёт `label=name`, `trashed=trashedAt!==null`, `parentId`/`starred` как есть; `null`-узел даёт `post:null`, а не фиктивный узел.
- **Сервис:** `DriveBulkServiceResult` — `DriveResult<DriveBulkServiceValue>`; per-ID `failed` остаётся в `items` и не превращает весь ответ в `ok:false`; `changed`, `post`, `removedIds` заполняются только подтверждённым состоянием после мутации.

#### Future: полный cross-folder manifest

Это **не этап 0**. В этапе 0 `chosen` остаётся срезом `drive.ids` текущей папки, а `chosen-hidden` блокирует Apply. Manifest — отдельный read-only слой для всех `picked` across folders; `picked` остаётся единственным источником выбранных ID и их порядка, а `drive.ids` в manifest не участвует.

##### Источник данных

```ts
export interface DriveManifestQuery {
  readonly ids: readonly string[] // picked: unique, ordered, 1..DRIVE_IDS_URL_MAX
  readonly cursor?: string
  readonly pageSize?: number
}

export interface DriveManifestCrumb {
  readonly id: string
  readonly label: string
}

export type DriveManifestItem =
  | {
      readonly status: 'ok'
      readonly id: string
      readonly label: string
      readonly parentId: string | null
      readonly path: readonly DriveManifestCrumb[] | null // null — предки не полностью читаемы
      readonly kind: 'file' | 'folder'
      readonly trashed: boolean
      readonly starred: boolean
    }
  | { readonly status: 'unavailable'; readonly id: string }

export interface DriveManifestPage {
  readonly items: readonly DriveManifestItem[] // только текущая страница, порядок = picked
  readonly total: number // число уникальных requested ID
  readonly counts: { readonly ok: number; readonly unavailable: number }
  readonly allResolved: boolean // проверены все requested ID, а не только текущая страница
  readonly nextCursor: string | null
}
```

- `loadDriveManifest` — новый read-only серверный loader/service (`load.server.ts` → `service/query.ts`), а `fetchDriveManifest` в `source.ts` — его JS-адаптер для следующей страницы. Он не вызывает `loadDriveList`, не читает `drive.ids` и не зависит от текущей папки, `identity`, фильтров или `filter_owner`. Это отдельный источник, а не второй список.
- `ids` — ровно `picked` в порядке выбора, без дублей; дубликаты схлопываются до запроса, порядок первого вхождения сохраняется. Больше 100 ID или сырая строка длиннее `DRIVE_IDS_URL_CHARS_MAX` — `400` до запроса; `ids=[]` не вызывает manifest и даёт `empty-chosen` из §7a.10.
- Сервер сам читает label, `parentId`, `kind`, `trashed`, `starred` и безопасный `path`; клиентские labels/status не принимаются. Один batch-запрос на страницу, без N+1 и без перебора чужих узлов.
- `total = ids.length`; `counts.ok + counts.unavailable === total`; `allResolved=true` только если проверены все requested ID. Если это не так, страница не считается полной: `alert`/retry, `Apply` закрыт, частичный manifest не показывается как полный.
- `items` — непрерывный срез в порядке `picked`; `nextCursor` — только позиция следующей страницы. `pageSize` по умолчанию 50, максимум 100; `total` не подменяется размером страницы. `total=100` при двух страницах — норма.

##### ACL

- Каждый ID проверяется текущей сессией через существующий ACL/share-механизм; manifest не является обходом `canRead` и не доверяет `picked` как доказательству доступа.
- Для отсутствующего узла и узла без права чтения используется один статус `unavailable` с одним `id`: без label, `parentId`, `path`, `kind`, `trashed`/`starred`. UI не должен различать `not-found` и `forbidden` по ответу manifest.
- `path` содержит только те предки, которые текущий пользователь может читать; если цепочка неполная, `path=null`, а не «сокращённый» путь с чужими label. `label` и `path` всегда серверные.
- ACL перепроверяется на каждой странице: доступ мог измениться между запросами. Изменение статуса на `unavailable` не удаляет ID из `picked` автоматически; оно только блокирует Apply и показывает действие удаления.
- Cursor не является авторизацией: его нельзя использовать для доступа к ID, не входящим в подписанный/связанный набор `ids`.

##### Пагинация

- Cursor — непрозрачный и связан с упорядоченным набором `ids` и текущим пользователем; при несовпадении набора/порядка или устаревшем cursor — `drive.manifest-stale`, без смешивания страниц и без молчаливого перехода на первую.
- Страницы идут по `picked`, а не по папкам/фильтрам. Клиент не строит offset вручную, не сортирует текущую страницу и не склеивает ответы с разными `ids`/`counts`.
- `nextCursor=null` — последняя страница; `allResolved` при этом уже true. Ошибка загрузки страницы оставляет последнюю успешно показанную страницу и `picked`, показывает `Alert`/retry и закрывает Apply; `empty-page` для manifest не используется.
- Изменение `picked` (удаление строки, «Убрать недоступные», «Снять весь выбор») инвалидирует cursor: следующий запрос начинается с первой страницы, старые страницы не подмешиваются.

##### Отображение

- В future `chosen` manifest заменяет текущий срез `drive.ids` и `chosen-hidden`/`hidden`: показываются все выбранные ID на страницах manifest, включая недоступные строки. `drive.ids` остаётся механикой этапа 0 и в manifest-режиме не пишется и не читается.
- Шапка: «Выбрано N» и «Недоступно M» из `total`/`counts`; диапазон страницы `start–end из total`. Строка `ok` показывает label, безопасный путь, kind и статус; строка `unavailable` — только id и «недоступен», без ложного label/пути.
- Порядок строк — `picked`; группировка по папкам допустима только как визуальная и не меняет порядок/пагинацию. Пустой `picked` → `empty-chosen`; непустой набор с `unavailable>0` — список + `Alert`, а не `empty-chosen-hidden` и не «ничего не выбрано».
- `Apply` доступен только когда manifest загружен, `allResolved=true`, `counts.unavailable=0` и нет ошибки страницы. Иначе он disabled; недоступные ID не отфильтровываются автоматически. `Apply` отправляет `picked.join(',')` в `param`; manifest только проверяет, но не меняет target и не добавляет `drive.ids` в `from`.

##### Действия

- «Удалить строку» убирает ID из `picked`, инвалидирует cursor и перезапрашивает первую страницу; повторное появление старой строки из старого ответа запрещено.
- «Убрать недоступные» — явное действие при `unavailable>0`: удаляет только `unavailable` ID из `picked`, затем перезапрашивает manifest; без подтверждения набор не чистится.
- «К выбору» сохраняет `picked` и возвращает в `pick` (с обычным `filter_owner`-контрактом §7a.4); «Снять весь выбор» очищает `picked`, возвращает в `pick` и сохраняет текущие фильтры с `filter_owner=chosen` по §7a.4; обе операции не трогают target.
- «Обновить»/«Повторить» повторяют manifest с теми же `ids`/cursor; ошибка страницы не меняет `picked`. «Применить» доступен по условиям выше и не зависит от текущей папки.
- Manifest не мутирует узлы, не вызывает bulk-операцию и не ревизует `picked`; его единственные записи — явные действия пользователя над `picked`.

##### Проверки manifest

- `ids` сохраняют порядок `picked`; дубликаты схлопываются; 101 ID/строка >4000 — `400`; `ids=[]` не делает запрос и даёт `empty-chosen`.
- `total`/`counts` сходятся на каждой странице; страницы не дублируют и не теряют ID; `nextCursor` ведёт только вперёд; чужой/устаревший cursor — `drive.manifest-stale`.
- `ok`-строка содержит серверные label/path/kind/status; `unavailable` не содержит label/path и не позволяет отличить missing от forbidden; `picked` при этом не меняется.
- ACL-изменение между страницами переводит ID в `unavailable`, блокирует Apply и не удаляет ID; ошибка страницы сохраняет предыдущую страницу и `picked`.
- Удаление строки/«Убрать недоступные»/«Снять весь выбор» инвалидируют cursor и не воскрешают старые страницы; `picked` остаётся упорядоченным.
- Все ID `ok` → Apply отправляет полный `picked` в исходном порядке; `unavailable>0` → Apply disabled; `drive.ids`/фильтры текущей папки не влияют на manifest.
- `ids≠[]` и `unavailable>0` → список/`Alert`, не `empty-chosen`/`chosen-hidden`; `ids=[]` → `empty-chosen`.

#### Gap: future-контракт vs текущие `DriveResult` / `ExecuteOutput` / `DriveTargetPicked`

Это **не** часть этапа 0 и не разрешение менять код сейчас. Раздел фиксирует разрыв между future-контрактом выше и фактическими типами, чтобы будущая реализация не выдала aggregate-ответ за per-ID и не расширила picker через `as`-каст.

| Слой | Что есть сейчас | Чего не хватает для future-контракта |
|---|---|---|
| Результат операции | `DriveResult<T>` — generic aggregate `value`/`code` на всю операцию | `DriveResult<DriveBulkOutcome>` — после объявления `DriveBulkOutcome` обёртка типизирует `value` как outcome; сам `DriveBulkOutcome` отсутствует. Aggregate `DriveResult` не заменяет per-ID `results`: из него нельзя получить `post`, `changed`, `retryable`, `code`/`params` или `removedIds`. |
| Узел после операции | `DriveNodeView`/строки списка | `DriveBulkNodeState` (`id`, `label`, `parentId`, `trashed`, `starred`) и адаптер из `DriveNodeView`: `label = name`, `trashed = trashedAt !== null`. |
| Элемент результата | нет | `DriveBulkItemResult` (`id`, `status`, `changed`, `retryable?`, `code?`, `params?`, `post`, `removedIds?`). |
| Итог группы | нет | `DriveBulkOutcome` (`operation`, `requested`, `results`, `succeeded`, `changed`, `failed`, `removed`) с инвариантами из §7a.9. |
| Запрос группы | текущие move/copy принимают один `target_id`; набора ID в контракте нет | `DriveBulkCommand` с `operation`, уникальными `ids`, optional `targetId`; отдельный `DriveBulkRequest` не нужен. Валидация пустого набора, лимита 200 и прав — до операции. |
| Имена операций | текущий серверный маршрут/операция | `DriveBulkOperation` (`trash`/`purge`/`restore`/`move`/`copy`/`rename`/`star`/`share`/`unshare`) и явный маппинг `DRIVE_BULK_OPERATION_TO_NAME`/`DRIVE_OPERATION_TO_BULK`: `trash` → `trash-action`, остальные одноимённы; `mkdir`/`upload`/`dav-issue`/`dav-revoke` исключены. UI не угадывает операцию по URL. |
| Execute-транспорт | `ExecuteOutput<T>` с `data`/`redirect`/`queued`; поля `submissionId` в нём нет | `DriveBulkExecuteData` (`outcome: DriveBulkOutcome`), `DriveBulkExecuteOutput = ExecuteOutput<DriveBulkExecuteData>`; корреляция остаётся в form-level `Result.submissionId`, а не дублируется в `data`. |
| Form-done | `DriveOperationDone.data` — `Record<string, unknown>` | `DriveBulkOperationDone`/`DriveBulkOperationDoneData` с типизированным `outcome`; без него потребитель вынужден кастовать `data` и теряет проверку `operation`. |
| Picker payload | `DriveTargetPicked = { seq, id: string \| null, label }`; `DrivePickerModal` кладёт `seq: Date.now()`, один ID на callback | `DrivePickerMode`, `DrivePickerStep`, `DriveTargetPickedBase`, `DriveTargetPickedSingle`, `DriveTargetPickedMultiple` (`ids`, `labels`, `mode:'multiple'`) и union `DriveTargetPicked`; текущий тип не несёт `mode`, `ids`, `labels` или `step`, а `seq` ещё не монотонный. |
| Picker data | `DrivePickerData` без `mode`/`step`/`picked` | `DrivePickerData` с `mode`, `step`, `picked`/`pickedCount`, `hiddenCount`; `DrivePickerData` не должен оставаться частично `single`-типом. |
| Picker URL | `DrivePickerParams`/`drivePickerHref` без `mode`; `step`/`picked` только как future | `DrivePickerParams` с `mode`, `step`, `picked`-пределом 100; `drivePickerHref` с mode-aware сигнатурой. |
| Picker props и callbacks | `DrivePicker`/`DriveBrowse` отдают `onPick(id)`; `DrivePickerModal` создаёт payload без `mode` | `DrivePickerProps`/`DriveBrowsePickerProps` с `mode`, `step`, `onPicked`, `onPick`; `DrivePickerData` и `DrivePickerParams` должны быть согласованы с union payload. |

**Недостающие bulk-типы:** `DriveBulkOperation`, `DriveBulkCommand` (без отдельного `DriveBulkRequest`), `DriveBulkNodeState`, `DriveBulkItemResult`, `DriveBulkOutcome`, а также адаптер `DriveNodeView → DriveBulkNodeState`. `DriveResult<T>` уже generic: после объявления `DriveBulkOutcome` обёртка `DriveResult<DriveBulkOutcome>` компилируется и типизирует `value`; без новых типов она не «становится `Record`/`unknown`», а просто не определена, потому что нет самого `DriveBulkOutcome`. `Record<string, unknown>` остаётся у текущего form-level `DriveOperationDone.data`, и именно для него нужен отдельный transport-тип.

**Недостающие transport-типы:** `DriveBulkExecuteData`, `DriveBulkExecuteOutput`, `DriveBulkOperationDone`, `DriveBulkOperationDoneData`. `ExecuteOutput<T>` сам по себе слишком общий: он не гарантирует наличие `outcome`, `operation` и инвариантов counts; `submissionId` должен читаться из `Result`, а не подменяться `Date.now()` или полем payload.

**Недостающие picker-типы:** `DrivePickerMode`, `DrivePickerStep`, `DriveTargetPickedBase`, `DriveTargetPickedSingle`, `DriveTargetPickedMultiple`, union `DriveTargetPicked`, расширенные `DrivePickerData`, `DrivePickerParams`, `DrivePickerProps`/`DriveBrowsePickerProps`. Текущий `{ seq, id, label }` достаточен только для `single`; для `multiple` ему не хватает `mode`, `ids`, `labels`, а для модалки — ветки `onPicked` и шага `chosen`.

**Сверка фактических сигнатур:** `DriveResult<T>` — `{ ok: true; value: T } | { ok: false; code: string; params?: Record<string, unknown> }`; `ExecuteOutput<T>` — `{ data?: T; redirect?: string; queued?: QueuedData }` и не содержит `submissionId`; `DriveOperationDone` — `{ ok: true; data: Record<string, unknown>; next: string }`; `DriveTargetPicked` — `{ seq: number; id: string | null; label: string }`. Поэтому generic-обёртка `DriveResult<DriveBulkOutcome>` не является источником `Record`/`unknown`: этот разрыв создаёт конкретный `DriveOperationDone.data`, а per-ID поля отсутствуют в `DriveBulkOutcome`/`DriveTargetPicked`.

**Границы:** gap не требует добавлять эти типы в этап 0, не меняет текущие `DriveResult`/`ExecuteOutput`/`DriveTargetPicked` и не разрешает `as`-каст multiple-payload в single. Пока типы не введены, future-поведение из §7a.9 остаётся спецификацией, а не реализуемым контрактом; UI этапа 0 продолжает использовать aggregate `DriveResult` и `single`-payload.

#### Минимальный дизайн bulk-сервиса и form-ответа

Минимальный путь — **одна bulk-команда на одну form-отправку**. Не нужны отдельная form-отправка на каждый ID, очередь, второй публичный route или `submissionId` в payload. Один `submissionId` идентифицирует всю группу; частичный успех живёт внутри одного `DriveBulkOutcome`, а не превращается в несколько ответов.

##### Типы

```ts
export interface DriveBulkCommand {
  readonly operation: DriveBulkOperation
  readonly ids: readonly string[] // unique, ordered, 1..DRIVE_IDS_MAX (200)
  // Поля ниже обязательны/запрещены в зависимости от operation;
  // это проверяет `driveBulkCommandOf`, а не сервис по факту.
  readonly targetId?: string | null // move/copy
  readonly name?: string // rename
  readonly starred?: boolean // star
  readonly subjects?: readonly string[] // share/unshare
  readonly role?: string // share
}

export interface DriveBulkExecuteData {
  readonly outcome: DriveBulkOutcome
}

export type DriveBulkExecuteOutput = ExecuteOutput<DriveBulkExecuteData>
export type DriveBulkOperationDoneData = DriveBulkExecuteData

export interface DriveBulkOperationDone {
  readonly ok: true
  readonly data: DriveBulkOperationDoneData
  readonly next: string
}

/** Форма отказа та же, что у одиночных операций: не дублируем поля. */
export type DriveBulkOperationFailure = DriveOperationFailure
export type DriveBulkOperationOutcome =
  | DriveBulkOperationDone
  | DriveBulkOperationFailure
```

- `DriveBulkCommand` — общий вход сервиса и формы. `DriveBulkRequest` не вводим: это был бы только алиас без нового смысла. Комбинацию `operation` + полей проверяет `driveBulkCommandOf` до сервиса; `ids` уже уникальны и не усечены.
- `DriveBulkExecuteData` содержит **только** `outcome`; `submissionId` здесь нет и не должно быть. `DriveBulkOperationDone` — серверная обёртка результата, а не form-level `Result`.
- `DriveBulkOperationFailure` переиспользует `DriveOperationFailure` (`code`, `field`, `params`): глобальный отказ не получает второй формы ошибки.

##### Функции

```ts
// operations.server.ts: op приходит из регистрации формы, не из values.
export function driveBulkCommandOf(
  operation: DriveBulkOperation,
  values: Readonly<Record<string, unknown>>,
): DriveResult<DriveBulkCommand>

export async function runDriveBulkOperation(
  operation: DriveBulkOperation,
  event: RequestEvent,
  values: Record<string, unknown>,
): Promise<DriveBulkOperationOutcome>

// service/bulk.ts: единственный цикл по ID, без вызовов form execute.
export async function bulkMutateDriveNodes(
  db: Database,
  actor: DriveActor,
  command: DriveBulkCommand,
): Promise<DriveBulkServiceResult>

// operations.form.server.ts: одна регистрация на bulk-операцию.
export function registerDriveBulkForms(): void

// Клиентская проверка перед ревизией picked.
export function driveBulkResultOutcome(
  result: Result<DriveBulkExecuteData>,
  state: {
    readonly operation: DriveBulkOperation
    readonly appliedSubmissionId: string | null
  },
): DriveBulkOutcome | null
```

- `driveBulkCommandOf` берёт `operation` из замыкания формы, парсит `ids` как UUID-список с дедупликацией и пределом 200, проверяет `targetId`/`name`/`starred`/`subjects`/`role` по операции. `move`/`copy` требуют явный `targetId` (`null` — корень), `rename` — `name`, `star` — `starred`, `share` — `subjects` и `role`, `unshare` — ровно один subject; пустой или невалидный набор — `DriveResult.ok:false` до мутации.
- `bulkMutateDriveNodes` проводит глобальную проверку прав/команды, затем по одному ID вызывает существующую одиночную мутацию. Успех одного ID не откатывается ошибкой следующего; каждый ID получает ровно один `DriveBulkServiceItem`.
- `runDriveBulkOperation` собирает актора и контекст возврата, вызывает сервис и через существующий `driveBulkOutcomeOf` превращает `DriveBulkServiceValue` в `DriveBulkOutcome`. `submissionId` он не создаёт и не принимает. Если `driveBulkCommandOf` вернул `ok:false`, он отдаёт `DriveBulkOperationFailure` с `field=driveOperationField(code)` (для `ids` — `ids`) до вызова сервиса.
- `registerDriveBulkForms` регистрирует формы по `DriveBulkOperation` с ID, производным от `spec.formId` (например, `${spec.formId}-bulk`), замыкает `op` и передаёт `idempotency`: без него `submissionId` — только корреляция, а повтор того же id может повторно выполнить мутации. Store должен вернуть тот же `Result`/outcome по id; TTL/резервирование — как у остальных форм. Operation не передаётся скрытым полем и не читается из `values`.
- `driveBulkResultOutcome` возвращает outcome только при `ok`, `outcome='committed'`, наличии `data`, совпадении `data.outcome.operation` с операцией формы и `result.submissionId !== state.appliedSubmissionId`. Иначе `null`: повтор того же ответа не ревизует `picked` дважды. `appliedSubmissionId` обновляется после применения; `Result` вне текущего `submit()` не применяется, потому что bind уже отбрасывает stale.

##### Form-ответ

`execute` остаётся тонким адаптером, как у одиночных операций:

```ts
execute: async ({ values, commit, fail }, event) => {
  const outcome = await runDriveBulkOperation(bulkOp, event, values)
  if (!outcome.ok) return fail([refuse(outcome.code, outcome.field, outcome.params)])
  commit()
  return { data: { outcome: outcome.data.outcome }, redirect: outcome.next }
}
```

- Успешный (в том числе частичный) ответ — `Result<DriveBulkExecuteData>`: `submissionId` ставит form-конвейер из конверта, `data.outcome` — per-ID итог, `redirect` — `next`.
- `DriveBulkOperationDone`/`DriveBulkOperationDoneData` — внутренний typed-вид серверного результата; потребитель читает `Result.data.outcome`, а не кастует `Record<string, unknown>`.
- `Result.errors` — только глобальный отказ/ошибки полей. Per-ID `failed` не дублируются в `Result.errors`; их коды и `params` лежат в `outcome.results`.
- `commit()` вызывается и когда все ID завершились `failed`: команда обработана, ответ должен кэшироваться по `submissionId`; это не превращает per-ID ошибки в глобальный `ok:false`.
- `redirectOnSuccess` остаётся прежним: `next` — локальный адрес, no-JS получает обычный PRG без плашки. Bulk-форма не делает `inline`-успех и не открывает второй route.

##### Partial success

- `DriveBulkServiceResult.ok:false` — только глобальный отказ до мутации (плохой набор, нет права на саму операцию, невалидный target): `results` нет, `picked` не меняется.
- `ok:true` — команда выполнена, даже если часть или все ID `failed`. `requested` равен числу уникальных ID; `succeeded + failed = requested`; `changed` считается только по подтверждённым no-op/изменениям.
- `failed` с живым узлом получает `post` этого узла; `failed` после удаления/без доступа — `post:null`. `retryable` выставляется только когда повтор безопасен; неизвестная ошибка не становится retryable по умолчанию.
- `removedIds` собираются из подтверждённых side-effect удалений и объединяются как множество; сервис не синтезирует их из запроса.
- Один ID — одна доменная транзакция/мутация. Общий batch не должен откатывать уже успешные ID; именно поэтому partial success не эмулируется одним all-or-nothing `DriveResult`.

##### `submissionId`

- Источник истины — `Result.submissionId`, который ставит form-конвейер из конверта. Сервер не читает `submissionId` из `values`, сервис его не возвращает, `DriveBulkOutcome`/`DriveBulkExecuteData` его не содержат.
- Одна группа = один `submissionId`. Нельзя создавать отдельный id на каждый ID: тогда ломается идемпотентность и один частичный исход превращается в несколько конкурирующих ответов.
- Повтор с тем же `submissionId` возвращает тот же `DriveBulkOutcome`; клиент применяет ревизию не более одного раза. После `isSettled(result)` следующая отправка получает новый id.
- Повтор только `retryable`-неудачных ID — **новая** команда с новым `submissionId` и `ids = failedIds`; успешные ID не отправляются повторно. Старый id остаётся только для показа/корреляции и не переиспользуется для новой мутации.
- `driveBulkResultOutcome` сверяет `operation` и не применённый `submissionId`; повтор/поздний ответ не ревизует `picked`. `submissionId` берётся только из `Result`, не из payload.

##### Что не добавляем

- `DriveBulkRequest`-алиас, отдельный queue/task-протокол, per-ID form-формы, `submissionId` в `DriveBulkOutcome` и второй набор `FormError` для per-ID ошибок.
- `DriveBulkItemResult`/`DriveBulkServiceItem` уже описаны выше; новый дизайн только соединяет их с формой и транспортом.

##### Проверки дизайна

- Partial success: A `ok`, B `failed` → `Result.ok=true`, `outcome='committed'`, `results` содержит обе строки, `Result.errors` пуст, `submissionId` один.
- Все ID `failed` → тот же `ok:true`/`committed`, `requested=failed`, без глобального `ok:false` и без потери per-ID кодов.
- Глобальный отказ (пустой/201 ID, невалидный target) → `ok:false`, `results` нет, мутаций нет, `picked` не меняется.
- `data.submissionId` отсутствует; клиент читает `Result.submissionId`, а `driveBulkResultOutcome` не применяет уже применённый id и чужую `operation`.
- Повтор с тем же `submissionId` при включённом `idempotency` возвращает тот же outcome и не выполняет мутации второй раз; повтор только `retryable` ID идёт новым id и не переотправляет успешные.
- Без `idempotency` повтор того же id не считается идемпотентным: это ошибка конфигурации bulk-формы, а не допустимый режим.
- Один ID — одна строка `results` в порядке `ids`; успешный ID не откатывается ошибкой следующего; `removedIds`/`post` не синтезируются из запроса.

### 7a.10. Таксономия пустых состояний

Пустое состояние — это не один текст «Ничего не найдено», а **причина, по которой список пуст**. От причины зависят заголовок, действие и даже компонент: `Empty`, `EmptyState`, `Alert`, `Acl` или скелетон. Таксономия нужна, чтобы не показывать «ничего не найдено» при загрузке, ошибке, отсутствии прав или пустом выбранном наборе.

#### Оси

| Ось | Значения | Что меняет |
|---|---|---|
| Причина | нет объектов / не совпало с фильтром / пустой выбор / страница вне диапазона / нет прав / ошибка / загрузка | заголовок, действие, компонент |
| Носитель | папка/корень, корзина, «Важное», пикер, шаг `chosen` | текст и доступные действия |
| Готовность | loading, ready, empty, error | можно ли вообще рисовать `Empty` |
| Действие | создать/загрузить, сбросить фильтр, вернуться, выбрать заново, повторить | primary/secondary |

#### Компоненты

- `EmptyState` — **детектор** состояния пагинатора: рисует слот только когда `status='idle'`, есть загруженные страницы, все они пусты и `totalItems` **известен**. При неизвестном `totalItems` он не рисует `Empty`; родитель показывает `Alert`/retry. Внутрь передаётся готовый `Empty`. Исключение — готовый `empty-chosen` при `picked=[]`: пустой выбор доказан без `totalItems`, и `EmptyState` не должен блокировать его как list-`Empty`; это не относится к `empty-chosen-hidden`/`empty-page`, которым `totalItems` нужен.
- `Empty` — **презентация** пустоты: иконка, заголовок, описание, действия, `variant`, `role`. Не знает, почему список пуст.
- `Alert` — ошибка загрузки, недоступность хранилища, отказ операции. Не маскируется под `Empty`.
- `Acl` — нет права читать список/узел. Это не «пустая папка».
- `Skeleton` — `status='init'/'loading'`. `Empty` в это время не рендерится.

#### Дерево решений

`totalItems` считается **известным** только если это конечное число `Number.isFinite(totalItems) && totalItems >= 0`; `null`, `undefined`, `NaN`, `Infinity` и отрицательное значение — неизвестны. Без известного `totalItems` при `items=[]` нельзя утверждать `empty-page`, `empty-directory`, `empty-filtered`, `empty-trash`, `empty-starred`, `empty-picker`, `empty-picker-filtered` или `empty-chosen-hidden`: показывается `Alert` с retry, а не пустота. При `items≠[]` это обычный список: видимые строки сами доказывают непустоту, `Empty` не нужен. Единственное исключение — `empty-chosen` при `picked=[]`: это доказанное отсутствие выбора, а не пустота списка, поэтому `totalItems` для него не нужен.

Проверять сверху вниз; первое совпадение выигрывает:

1. `status='init'/'loading'` → скелетон, не `Empty`.
2. `fact`/`!caps.canRead` → `Acl`/`Alert`, не `Empty`.
3. Шаг `chosen` при `mode=multiple`:
   - `picked=[]` → `empty-chosen` (доказано пустым выбором; `totalItems` не требуется);
   - `picked≠[]` и (`!known(totalItems)` или `hiddenCount === null`) → `Alert`/retry, не `empty-chosen-hidden`;
   - `picked≠[]` и `hiddenCount` не целый/вне `0..picked.length` → `Alert`/inconsistent;
   - `picked≠[]`, `totalItems===0` и `hidden !== picked.length` → `Alert`/inconsistent; при `totalItems===0` и `items≠[]` — тоже `Alert`; `total` — `visiblePicked`, количество `picked` в текущем срезе на всех страницах (`totalItems` среза `drive.ids`), не размер страницы;
   - `picked≠[]`, `hidden>0` и `totalItems===0`: `items=[]` → `empty-chosen-hidden`; `items≠[]` → `Alert`/inconsistent, не `chosen-hidden`;
   - `picked≠[]`, `hidden>0` и `totalItems>0`: `items≠[]` → `list` с `hidden` и `Alert`, не `Empty`; `items=[]` при `page>1` → `empty-page`, иначе `Alert`/inconsistent;
   - `picked≠[]`, `hidden=0` и `items≠[]` → обычный `chosen`-список только при `totalItems>0`; при `totalItems===0` — `Alert`/inconsistent;
   - `picked≠[]`, `hidden=0`, `items=[]` и `totalItems>0`: при `page>1` → `empty-page`, иначе (`page<=1`) → `Alert`/retry как противоречие данных;
   - иначе в `chosen` → `Alert`/inconsistent; в list-`Empty` не выходить;
4. `items≠[]` → обычный список; `totalItems===0` при `items≠[]` → `Alert`/retry. При `items=[]` и `!known(totalItems)` → `Alert`/retry, не `empty-page`/`empty-directory`/`empty-filtered`/`empty-trash`/`empty-starred`/`empty-picker`/`empty-picker-filtered`.
5. `page > 1` и `totalItems > 0` → `empty-page` (страница вне диапазона; `totalItems` уже известен).
6. `page <= 1`, `totalItems > 0` и `items=[]` — противоречие данных: `Alert`/retry, не `empty-directory`.
7. Пикер:
   - есть активный поиск/фильтр → `empty-picker-filtered`;
   - иначе → `empty-picker`.
8. Есть активный поиск/фильтр (`q`, тип, даты, scope, размер не считается фильтром) → `empty-filtered`.
9. `identity='trash'` → `empty-trash`.
10. `identity='starred'` → `empty-starred`.
11. `totalItems === 0` → `empty-directory`.
12. Иначе → `Alert`/retry: пустой ответ без подтверждённого нуля или корректной страницы.

#### Контракт `DriveEmptySpec`

`DriveEmptySpec` — дискриминированный результат, а не набор экранных `{#if}`. `driveEmptyOf` — единственная точка выбора; дерево выше и таблица ниже — его документация. При расхождении выигрывает `driveEmptyOf`; новый `kind` нельзя добавить без расширения union и ветки функции.

```ts
export type DriveEmptyKind =
  | 'directory' | 'filtered' | 'trash' | 'starred'
  | 'picker' | 'picker-filtered'
  | 'chosen' | 'chosen-hidden' | 'page';

export type DriveEmptyAction =
  | 'upload' | 'create-folder'
  | 'reset-filters' | 'clear-search'
  | 'to-pick' | 'clear-picked'
  | 'previous-level' | 'first-page' | 'to-drive'
  | 'retry';

export type DriveEmptySpec =
  | { component: 'skeleton' }
  | { component: 'acl' }
  | { component: 'alert'; reason: 'load' | 'storage' | 'unknown' | 'inconsistent'; retry: boolean }
  | { component: 'list'; hidden?: number }
  | {
      component: 'empty';
      kind: DriveEmptyKind;
      title: string;
      description: string;
      variant: 'default' | 'picker' | 'chosen';
      actions: readonly DriveEmptyAction[];
      hidden?: number;
    };

export type DriveEmptyInput = {
  status: 'init' | 'loading' | 'idle' | 'error';
  fact: null | 'forbidden' | 'storage' | 'unknown';
  canRead: boolean;
  surface: 'list' | 'picker';
  step: 'pick' | 'chosen' | null; // chosen — только multiple; single нормализует в pick/null, null — обычный список
  pickedCount: number;
  hiddenCount: number | null; // picked - visiblePicked; null — visiblePicked неизвестен
  totalItems: number | null | undefined; // общий total среза; в chosen — visiblePicked (все страницы), null/undefined — неизвестен
  page: number;
  itemCount: number;
  identity: 'directory' | 'trash' | 'starred';
  hasFilters: boolean;
  hasSearch: boolean;
  canWrite: boolean;
  mode: 'single' | 'multiple';
};
```

`filter_owner` не входит в `DriveEmptyInput`: это служебный маркер, а не фильтр. `hasFilters`/`hasSearch` считаются только по `q`/типу/датам/поиску; один `filter_owner=chosen` без активных фильтров не даёт `empty-picker-filtered`.

`hiddenCount` — это `pickedCount - visiblePicked`, где `visiblePicked` — `totalItems` среза `drive.ids` (число выбранных на всех страницах), а **не** `itemCount` текущей страницы; `totalItems` вне `chosen` нужен для доказательства пустоты списка и `page`/`directory`. Если `hiddenCount` неизвестен, `Apply` закрыт; функция возвращает `alert`, а не `chosen-hidden`. `component='list'` с `hidden>0` — это видимые строки плюс `Alert`, а не `Empty`; `hidden` в `DriveEmptySpec` нужен для передачи счётчика в этот `Alert`.

Порядок в `driveEmptyOf` канонический и не переставляется:

1. loading/init → `skeleton`;
2. ACL/error/storage → `acl`/`alert`;
3. `chosen` → пустой выбор, hidden, `empty-page` при `page>1`, иначе обычный список/`Alert`;
4. `itemCount > 0` → `list` (но `totalItems === 0` при видимых строках → `alert`); частичное скрытие `chosen` — `list` с `hidden`, не `Empty`;
5. `itemCount=0` и неизвестный `totalItems` → `alert`, не `page`/`directory`/`filtered`/`trash`/`starred`/`picker`/`picker-filtered`;
6. `page > 1` при `totalItems > 0` → `page`;
7. `totalItems > 0` на первой странице при `items=[]` → `alert` (противоречие), не `directory`;
8. picker → `picker-filtered`/`picker`; иначе фильтры → `filtered`;
9. `trash` → `trash`;
10. `starred` → `starred`;
11. `totalItems === 0` → `directory`;
12. иначе → `alert`/retry.

```ts
const known = (n: number | null | undefined): n is number =>
  typeof n === 'number' && Number.isFinite(n) && n >= 0;

const empty = (
  kind: DriveEmptyKind,
  i: DriveEmptyInput,
  hidden?: number,
): DriveEmptySpec => ({
  component: 'empty',
  kind,
  ...DRIVE_EMPTY_COPY[kind](i),
  ...(hidden === undefined ? {} : { hidden }),
});

export function driveEmptyOf(i: DriveEmptyInput): DriveEmptySpec {
  // 1–2. Готовность и отказ важнее причины пустоты.
  if (i.status === 'init' || i.status === 'loading') return { component: 'skeleton' };
  if (i.fact === 'forbidden' || !i.canRead) return { component: 'acl' };
  if (i.fact === 'storage') return { component: 'alert', reason: 'storage', retry: true };
  if (i.status === 'error' || i.fact === 'unknown') {
    return { component: 'alert', reason: 'load', retry: true };
  }

  // 3. chosen раньше totalItems: пустой picked доказуем без total.
  // В single шага chosen нет; если он пришёл, он не должен включать chosen-ветку.
  if (i.surface === 'picker' && i.mode === 'multiple' && i.step === 'chosen') {
    if (i.pickedCount === 0) return empty('chosen', i);
    if (!known(i.totalItems) || i.hiddenCount === null) {
      return { component: 'alert', reason: 'unknown', retry: true };
    }
    if (!Number.isInteger(i.hiddenCount) || i.hiddenCount < 0 || i.hiddenCount > i.pickedCount) {
      return { component: 'alert', reason: 'inconsistent', retry: true };
    }
    if (i.totalItems === 0 && i.hiddenCount !== i.pickedCount) {
      return { component: 'alert', reason: 'inconsistent', retry: true };
    }
    if (i.totalItems === 0 && i.itemCount > 0) {
      return { component: 'alert', reason: 'inconsistent', retry: true };
    }
    if (i.hiddenCount > 0) {
      // Все скрыты — только total=0. При total>0 часть picked видна на других страницах,
      // поэтому пустая страница — page/alert, а не chosen-hidden.
      if (i.totalItems === 0) return empty('chosen-hidden', i, i.hiddenCount);
      if (i.itemCount > 0) return { component: 'list', hidden: i.hiddenCount };
      if (i.page > 1) return empty('page', i);
      return { component: 'alert', reason: 'inconsistent', retry: true };
    }
    if (i.itemCount > 0) return { component: 'list' };
    if (i.totalItems > 0 && i.page > 1) return empty('page', i);
    return { component: 'alert', reason: 'inconsistent', retry: true };
  }

  // 4. Есть видимые строки — это не пустой экран; total=0 при них — противоречие.
  if (i.totalItems === 0 && i.itemCount > 0) {
    return { component: 'alert', reason: 'inconsistent', retry: true };
  }
  if (i.itemCount > 0) return { component: 'list' };

  // 5. Неизвестный total не превращается в 0.
  if (!known(i.totalItems)) {
    return { component: 'alert', reason: 'unknown', retry: true };
  }

  // 6. Page доказывается только известным total > 0.
  if (i.page > 1 && i.totalItems > 0) return empty('page', i);

  // 7. Пустая первая страница при total > 0 — противоречие данных.
  if (i.page <= 1 && i.totalItems > 0 && i.itemCount === 0) {
    return { component: 'alert', reason: 'inconsistent', retry: true };
  }

  // 8. Носитель и фильтры: picker важнее общего фильтра.
  if (i.surface === 'picker') {
    return empty(i.hasFilters ? 'picker-filtered' : 'picker', i);
  }
  if (i.hasFilters) return empty('filtered', i);

  // 9–11. Специальные носители; directory — только total === 0.
  if (i.identity === 'trash') return empty('trash', i);
  if (i.identity === 'starred') return empty('starred', i);
  if (i.totalItems === 0) return empty('directory', i);

  // 12. Всё остальное — не Empty, а ошибка контракта.
  return { component: 'alert', reason: 'inconsistent', retry: true };
}
```

`DRIVE_EMPTY_COPY` — типизированная таблица `Record<DriveEmptyKind, (i) => Pick<...>>`: заголовок, описание, `variant` и действия. Поэтому таблица ниже — только представление `DriveEmptyKind`, а не отдельная логика приоритета.

#### Контракт состояний

| `kind` | Заголовок | Описание | Primary | Secondary |
|---|---|---|---|---|
| `directory` | «Папка пуста» / «Диск пуст» | «Здесь пока нет файлов и папок» | «Загрузить», «Создать папку» при `canWrite` | — |
| `filtered` | «Ничего не найдено» | «Ни один объект не подходит под фильтры» | «Сбросить фильтры» | «Очистить поиск», если был `q` |
| `trash` | «Корзина пуста» | «Удалённые объекты появятся здесь» | «На диск» | — |
| `starred` | «Нет важного» | «Отметьте файл или папку звёздочкой» | «На диск» | — |
| `picker` | «В этой папке нечего выбрать» | `single`: «Перейдите выше или выберите текущую папку/корень»; `multiple`: «Перейдите выше и отметьте объекты» | `single`: «Выбрать эту папку»/«Выбрать корень» остаются в футере; `multiple`: таких кнопок нет | «На уровень выше» |
| `picker-filtered` | «Ничего не найдено» | «Фильтры пикера не дали совпадений» | «Сбросить фильтры» | Футер выбора остаётся; в `multiple` без current/root |
| `chosen` | «Ничего не выбрано» | «Вернитесь к выбору и отметьте объекты» | «К выбору» | — |
| `chosen-hidden` | «Выбранные не видны» (только `total=0`) | «N выбранных находятся в другой папке, недоступны или скрыты собственным фильтром; они остаются в наборе, но Apply недоступен» | «К выбору» | При активных собственных фильтрах — «Сбросить фильтры»; иначе «Снять весь выбор» |
| `page` | «Страница пуста» | «На этой странице больше нет объектов» | «К первой странице» | — |

#### Правила

- **Приоритет важнее текста.** Ошибка/ACL/loading никогда не рендерятся как `Empty`; `chosen` никогда не рендерится как «папка пуста».
- **`empty-page` ≠ `empty-directory`.** При известном `totalItems > 0` и пустой странице `page > 1` предлагается только возврат к первой странице. `empty-page` не показывается при неизвестном `totalItems` или `page <= 1`.
- **`empty-directory` требует доказательства.** Только известный `totalItems === 0`; при `totalItems > 0` и пустой первой странице это противоречие данных (`Alert`/retry), а не пустая папка. При `null`/`undefined`/`NaN`/отрицательном `totalItems` пустой папки тоже нет — только `Alert`/retry.
- **Неизвестный `totalItems` не становится нулём.** Не подставлять `0` через `??`/`||`, не считать пустую текущую страницу доказательством пустого результата. При неизвестном `totalItems` не рендерятся `empty-page`, `empty-directory`, `empty-filtered`, `empty-trash`, `empty-starred`, `empty-picker`, `empty-picker-filtered` и `empty-chosen-hidden`; исключение — `empty-chosen` при `picked=[]` (доказан пустой выбор, а не пустота списка).
- **`empty-filtered` ≠ `empty-directory`.** При активном фильтре primary — сброс фильтра, а не «загрузить файл».
- **Пустой `chosen` — это не пустой список.** `drive.ids=none` означает явно пустой набор; `Apply` недоступен, `Empty` ведёт назад к выбору. Полный список не возвращается.
- **`chosen-hidden` — не удаление.** Если `picked` непуст, но часть или все ID вне текущего среза, нельзя молча чистить набор. Показывайте `hidden` и блокируйте `Apply`; выход — «К выбору», при активных собственных фильтрах — «Сбросить фильтры», иначе явное «Снять весь выбор». Как `DriveEmptyKind` `chosen-hidden` существует только при `total=0`; при частичном скрытии это `list` + `Alert`, а не `Empty`.
- **`chosen` не наследует pick-фильтры, но применяет собственные.** `q`/`type`/датовые `from`/`to`, активные в `pick`, автоматически не применяются к `drive.ids` в `chosen`; иначе выбранные исчезают из обзора из-за фильтра, которым их искали. При обычном `pick → chosen` без `filter_owner=chosen` они сбрасываются (page=1); identity/`kind`/`mode`/`picked`/адресный `from`/`param` сохраняются, а с маркером фильтры остаются собственными. Если те же ключи есть в direct-URL `chosen` или пользователь применил их в самом шаге, это **собственные** фильтры `chosen`: они применяются к `drive.ids`, могут дать `chosen-hidden`, и для них работает «Сбросить фильтры».
- **Сброс собственного фильтра `chosen` не сбрасывает выбор.** «Сбросить фильтры» меняет только фильтры текущего среза, снимает `filter_owner=chosen` и сохраняет `picked`, `upicks`, `drive.ids`, `mode`, `kind`, `from`, `param`; иначе скрытые выбранные потерялись бы под видом «показать всё».
- **Частичное скрытие `chosen` — не `Empty`.** Видимые строки остаются в `Listing`, над ними `Alert` с числом скрытых; `Empty` `chosen-hidden` — только когда `total=0`. Иначе пользователь потеряет видимую часть набора.
- **Полный кросс-папочный manifest — future.** В этапе 0 нельзя подменять его «показать всё» по локальному `picked`: для чужих папок нужны ACL и метаданные; `Apply` при `hidden>0` просто недоступен. Контракт — §7a.9.
- **Пикер не предлагает create/upload.** Его пустота — про выбор, а не про управление папкой; действия выбора текущей папки/корня остаются в футере.
- **Read-only папка.** `empty-directory` без `canWrite` не показывает «Загрузить/Создать»; остаётся только описание.
- **Один `Empty` на экран.** Не дублировать пустоту в `Listing` и рядом в `DriveBrowse`.
- **No-JS = JS.** Все действия — ссылки/`Button href`; JS может открыть модалку, но без JS тот же путь работает. `data-testid` — по `kind`, не по тексту.

#### Сброс из `Empty`

`Empty` сам ничего не меняет: все действия — GET-ссылки, а состояние меняет только выбранный переход. `picked` и `drive.ids` не выводятся из видимой страницы и не очищаются побочно; `drive.ids` пересобирается только из `picked` в `chosen` (например, в `empty-page`), а в `pick` удаляется.

**`empty-picker-filtered` (фильтры пикера не дали совпадений):**

- «Сбросить фильтры» — остаётся в `pick`, `step` не меняется; очищаются только `q`/`type`/датовые `from`/`to`, `page=1`; `picked` (в `multiple`), `mode`/`kind`/`from`/`param` и текущая папка сохраняются; `upicks`/`drive.ids` снимаются, потому что в `pick` их быть не должно. `filter_owner=chosen` снимается, потому что это изменение фильтров в `pick`; target не заполняется.
- Если маркер стоял после возврата из `chosen`, сброс делает фильтры pick-фильтрами; следующий `pick → chosen` их не наследует.

**`empty-chosen` (выбор пуст):**

- «К выбору» — `step=pick`; `picked` уже пуст, `upicks=chosen`/`drive.ids=none` снимаются; текущие собственные фильтры (если были) сохраняются, `filter_owner=chosen` ставится, чтобы возврат не выдал их за pick-фильтры. `mode`/`kind`/`from`/`param` сохраняются; target не заполняется.

**`empty-chosen-hidden` (все выбранные скрыты):**

- «К выбору» — `step=pick`, `picked` без изменений, `upicks`/`drive.ids` снимаются, текущие собственные фильтры сохраняются с `filter_owner=chosen`; `mode`/`kind`/`from`/`param` сохраняются; target не заполняется.
- «Сбросить фильтры» — при активных собственных фильтрах `chosen`: `step` остаётся `chosen`, `picked` тот же, `upicks=chosen` и `drive.ids` те же, `mode`/`kind`/`from`/`param` сохраняются; сбрасываются только фильтры и снимается `filter_owner=chosen`, страница возвращается на 1. Если после сброса `hidden` всё ещё больше 0 (выбранные в другой папке или недоступны), остаётся состояние `chosen-hidden` (`list` + `Alert`; `Empty` только при `total=0`), `Apply` по-прежнему закрыт; набор не чистится.
- «Снять весь выбор» — показывается, когда активных собственных фильтров нет: `step=pick`, `picked=[]`, `upicks`/`drive.ids` снимаются, остальной контекст сохраняется; текущие фильтры (если есть) сохраняются с `filter_owner=chosen`, чтобы возврат не выдал их за pick-фильтры. Это явная очистка, а не автоматическая.

При частичном скрытии это не `Empty`, а видимые строки + `Alert`; ссылка «Сбросить фильтры» там ведёт себя так же и не теряет `picked`/`drive.ids`.

**`empty-page`:**

- «К первой странице» — меняется только `page` на 1; identity и `picked` сохраняются. В `pick` текущие фильтры и `filter_owner` (если стоит) сохраняются; в `chosen` сохраняются собственные фильтры `chosen` (если они есть). В `chosen` дополнительно выставляются `upicks=chosen` и `drive.ids = picked.join(',')` — срез пересобирается из `picked`, а не копируется из старого query; `filter_owner=chosen` сохраняется, если он уже стоит. В `pick` сохраняется `picked`, но `upicks`/`drive.ids` удаляются, даже если они были в raw URL. `mode`/`kind`/адресный `from`/`param` сохраняются всегда. Target не заполняется.
- В обычном списке вне пикера ссылка сбрасывает только страницу через `driveListHref`; в пикере — через `drivePickerHref` с picker-контекстом, иначе `drive.ids`/`picked` потеряются.
- `empty-page` не сбрасывает фильтры и не вызывает `Apply`; после перехода пользователь видит первую страницу того же среза.

#### Проверки

- loading не показывает `Empty`; error/ACL/storage не показывают `Empty`.
- Пустая папка без фильтров при известном `totalItems=0` → `directory`; с `q`/типом/датами при том же известном нуле → `filtered`; read-only → без CTA. При неизвестном `totalItems` — `Alert`/retry, не `directory`/`filtered`.
- `page=2`, `totalItems>0`, `items=[]` → `page`, а не `directory`.
- `totalItems=null`/`undefined`/`NaN`/отрицательный, `items=[]` на page 1 или 2 → `Alert`/retry, не `page`, `directory`, `filtered`, `trash`, `starred`, `picker`, `picker-filtered` и не `chosen-hidden`; `totalItems` не заменяется на `0`.
- `totalItems=0`, `page=1` → `directory`; `totalItems=0`, `page=2` → тоже `directory`, а не `page` (объектов нет вообще).
- `totalItems>0`, `page=1`, `items=[]` → `Alert`/retry как противоречие данных, не `directory`; `totalItems>0`, `page=2`, `items=[]` → `page`.
- `totalItems=Infinity` или строка/`NaN` → неизвестен: при `items=[]` ни `page`, ни `directory`, ни `filtered`/`trash`/`starred`/`picker`/`picker-filtered`/`chosen-hidden` не показываются; только `Alert`/retry (кроме `empty-chosen` при `picked=[]`); при `items≠[]` — обычный список.
- `driveEmptyOf` при неизвестном `totalItems` и `items=[]`: единственный `empty` — `chosen` с `picked=[]`; остальные входы дают `alert`, включая `picker`/`filtered`/`trash`/`starred`/`page`/`chosen-hidden`.
- Корзина/«Важное» без фильтров при известном `totalItems=0` → `trash`/`starred`; с фильтрами → `filtered` при известном нуле; при неизвестном `totalItems` — `Alert`/retry, не `trash`/`starred`/`filtered`.
- Пикер без объектов при известном `totalItems=0` → `picker`, футер выбора доступен; с фильтром → `picker-filtered`; при неизвестном `totalItems` — `Alert`/retry, не `picker`/`picker-filtered`.
- `filter_owner=chosen` не считается фильтром: без `q`/типа/дат даёт `picker`, не `picker-filtered`; сброс из `picker-filtered` снимает маркер, удаляет `upicks`/`drive.ids`, не переносит фильтры обратно и не меняет target.
- `chosen` с `picked=[]` → `chosen`, Apply нет (при любом `totalItems`, включая неизвестный: доказан пустой выбор, а не пустой список); `picked≠[]` при неизвестном `totalItems`/`hiddenCount` → `Alert`/retry; `picked≠[]`, `hidden>0`, `totalItems===0`, `items=[]` → `chosen-hidden` (все скрыты); `picked≠[]`, `hidden>0`, `totalItems>0`, `items≠[]` → список с hidden; `picked≠[]`, `hidden>0`, `totalItems>0`, `items=[]` → `page` при `page>1`, иначе `Alert`; `hidden=0`, `items≠[]` при `totalItems>0` → обычный список, при `totalItems=0` → `Alert`; `hidden=0`, `items=[]`, `totalItems>0` → `page` при `page>1` и `Alert`/inconsistent при `page<=1`; `hidden=0`, `totalItems=0` → `Alert` (не list и не `empty-picker`).
- `hidden` считается по `total` всех страниц, а не по текущей странице: выбранные на другой странице того же среза не блокируют Apply; неизвестный/больший `total` — fail closed, Apply disabled.
- Частичное скрытие `chosen`: видимые строки + `Alert`/счётчик, Apply disabled; все скрыты (`total=0`) → `Empty` `chosen-hidden`, не «ничего не выбрано».
- Скрытие собственным фильтром `chosen`: `Сбросить фильтры`; скрытие другой папкой/недоступностью при отсутствии активных собственных фильтров: `К выбору`/`Снять весь выбор`; при активных фильтрах сначала доступен только их сброс. Молчаливой чистки нет. Унаследованные pick-фильтры в `chosen` не применяются.
- `pick → chosen` с активными `q`/`type`/датовыми `from`/`to`: унаследованные фильтры сброшены, page=1, все `picked` текущего среза видны, `hidden=0`; прямой `chosen`-URL с этими ключами считает их собственными фильтрами и может дать состояние `chosen-hidden` — сброс этих фильтров возвращает видимость, если скрытие было только из-за них; скрытые другой папкой/недоступностью остаются в состоянии `chosen-hidden`.
- `empty-page`: «К первой странице» сохраняет `picked`; в `pick` — активные фильтры и `picked`, при этом `upicks`/`drive.ids` удаляются даже из raw URL; в `chosen` — `upicks=chosen`, `drive.ids=picked.join(',')` (пересобранный срез, не копия query) и собственные фильтры `chosen`; target не появляется. В обычном списке picker-ключей нет.
- `empty-page` raw cases: в `pick` `drive.ids=A,B`/`upicks=chosen` не попадают в ссылку; в `chosen` при `drive.ids=none` или отсутствии ссылка получает `drive.ids` из `picked` и `upicks=chosen`; порядок `picked` не меняется.
- `drive.ids=none` → `chosen`, а не полный список; сброс фильтра не воскрешает набор.
- No-JS: все primary-действия — рабочие GET-ссылки; `data-testid` стабилен.
- `driveEmptyOf`: каждый `DriveEmptyKind` достижим хотя бы одним входом; возвращённый `kind` совпадает с таблицей, а не выбирается экранным `{#if}`.
- Приоритет: loading побеждает error; `chosen` с `picked=[]` побеждает неизвестный total; `chosen-hidden` только при `total=0` побеждает `page`; при `hidden>0`, `total>0` и пустой странице побеждает `page` (или `Alert` на `page<=1`), а не `chosen-hidden`; неизвестный total побеждает `page`/`directory` и остальные list-`Empty` (кроме `empty-chosen` при `picked=[]`); picker побеждает общий фильтр.
- `hiddenCount=null` или `hiddenCount<0`/`>pickedCount`/нецелый → `alert`, не `chosen-hidden`; `hiddenCount=0` при `picked≠[]` и известном `totalItems>0` → `list`, не `Empty`; при `totalItems=0` это противоречие → `alert`.
- `hiddenCount>0`, `totalItems=0`, `itemCount=0` → `component='empty'`, `kind='chosen-hidden'`; `hiddenCount>0`, `totalItems>0`, `itemCount=0` → `page` при `page>1`, иначе `Alert`; `hiddenCount>0`, `totalItems>0`, `itemCount>0` → `component='list'` с `hidden`, а `Empty` не рендерится; при `totalItems=0` — `Alert` (не list).
- `itemCount>0` при `totalItems=0` → `alert`/retry, не `list` и не `Empty`.

#### Аудит §7a (2026-11-20): устранённые противоречия

Проверено всё: §7a.1–§7a.10 на `hidden`/`chosen`/`Apply`, `totalItems` и no-JS. Ниже — что было противоречиво и как исправлено.

1. **Apply описывался тремя разными условиями.** §7a.3 требовал `known(totalItems)` + `hiddenCount===0`, §7a.4/§7a.6 — только «непустой набор и `hidden=0`», §7a.9 добавлял неизвестный `total`. Теперь есть один `canApplyChosen` в §7a.2a; остальные места ссылаются на него и не переписывают условие.
2. **Одно поле под тремя именами.** `total`, `snapshot.total`, `totalItems` обозначали одно и то же. В тесте про `chosen` это `visiblePicked` (все страницы среза `drive.ids`), вне `chosen` — общий total списка. Канон: `totalItems`, смысл — `visiblePicked`; «total» без уточнения больше не используется.
3. **Предел `drive.ids` имел два взаимоисключающих расписания.** §7a.2 бросал `400` при `>100` прямо в `loadDriveList`, а §7a.6/§7a.7 дважды фиксировали, что `parseDriveIdsUrl`/100/`400` — future, а в этапе 0 список живёт на legacy-потолке 200. Оставлено расписание §7a.6/§7a.7: этап 0 — 200 и без `400`, 100 — предел builder'а пикера; `parseDriveIdsUrl` с `overflow` — отдельная миграция.
4. **Отметка строки в no-JS не имела контракта.** §7a.4 относил «отметку» к no-JS-ссылкам, §7a.3 требовал `Checkbox`. Добавлено правило прогрессивного улучшения: SSR — GET-ссылка с `aria-pressed`, после гидрации — `Checkbox`; оба пишут только `picked`.
5. **«Сбросить фильтры» и «Снять весь выбор» читались как одновременные.** Формулировка футера склеивала их через «иначе», хотя §7a.9/§7a.10 требуют при активных собственных фильтрах только сброс. Футер переписан: сброс фильтров — при активных фильтрах, «Снять весь выбор» — только когда их нет.
6. **Не было сказано, кто считает `hiddenCount` для SSR.** Добавлено: сервер считает из `snapshot.total` среза `drive.ids` и передаёт в `DrivePickerData`; клиент не пересчитывает из видимых строк.

Проверено и оставлено как есть (не противоречия):

- `hiddenCount = pickedCount - visiblePicked`, диапазон `0..pickedCount`, `chosen-hidden` только при `totalItems=0`; частичное скрытие — `list` + `Alert`. Совпадает в §7a.2a, §7a.3, §7a.9, §7a.10.
- `empty-chosen` при `picked=[]` не требует `totalItems`; остальные `Empty` требуют известного total. Исключение описано одинаково в §7a.10 и в `DriveEmptyInput`.
- `empty-page` — только при известном `totalItems>0` и `page>1`; `page<=1` при непустом total — `Alert`/retry. Совпадает в дереве решений и в `driveEmptyOf`.
- `filter_owner` — служебный маркер, не фильтр, только `multiple`, не входит в `codec`/`extra`/`from`.
- Нормализация `step=chosen` → `pick` в `single` и снятие `picked`/`upicks`/`drive.ids`/`filter_owner`.

Оставшиеся дубли (не противоречия, к объединению при пересортировке плана): `filter_owner` описан и в §7a.4, и в §7a.6; перечень пустых состояний повторяется в §7a.3, §7a.9 и §7a.10.

---

## 8. План миграции (этапы)

Порядок жёсткий: **сначала arch (`refs/core`), потом drive (`refs/module-drive`)**. Пять этапов arch, четыре drive. Идентификаторы `A1–A5`/`D1–D4` стабильны и используются в ссылках из §7a/§9/§9a/§10.

### A. Arch (`refs/core`)

**A1. Контракты и уведомления.** — `[x]` done (`8070bef5`, `74774ed9`, `50a03bb7`).
- Убрать inline-плашки и `?notice=`, ошибки — в форму, частичный успех — `Result.data`; удалить мёртвые `rename-failed` и `?done=1` (§8a).
- Тост: `z-300`, дедупликация `text + tone` с продлением таймера, лимит 3, один `aria-live`, снятие таймеров (§8a.3).
- Тесты и README, затронутые этими изменениями.

**A2. Модалки и версии.** — `[x]` done (`ac67096a`, `4084fcb4`).
- Версия: `kit.version.name`/`pollInterval`, `updated.current` → guarded reload, `chunk-stale` классифицируется и лечится перезагрузкой.
- Окно открывается только по `ready` (данные и чанк); при ошибке — карточка retry, без скелетона. Пока не готово, диалог и фон закрыты.
- hover-prefetch оставлен: он только греет данные и модалку не открывает.

**A3. Базовые примитивы.** — `[x]` done (`f7013816`, `ec8f9518`, `b5f75548`).
- `Empty` (§3a), `OverflowMenu` + `MoreHorizontalIcon` (§5), `Attachment` folder/count/badges (§4).
- Проверки: `vitest` по `core/ui/{empty,overflow-menu,attachment}` — 17 тестов; `check` — baseline 64, ни одной в новых файлах.

**A4. `Surface.rail` и модульные настройки.** — `[-]` в работе.
- `[x]` `Surface.rail` (`b4f9e901`): один DOM, десктоп — колонка, узкий экран — строка с прокруткой; тесты SSR.
- `[x]` Реестр `SettingsSection` (`2edc4c64`): `uid` в контексте, `visible`/`ownOnly`, порядок; тесты.
- `[ ]` `settings.ext.ts` + glob, `UserConfig` → `SettingsHost` на `Surface.rail`, «Сессии» — самодостаточный список (§10b).

**A5. Base UI, паттерны и проверки arch.**
- Мобильный аудит base UI: `SurfaceBar`, `SearchBar`, `PageNav`, `Badge`, `FileAttachment`, `Floating`, `PaginatorSettings`, классы модалок (§9).
- `Item` family, `DescriptionList`, `FormMessage`, `EntryCard` + замены §10.3 в arch (§10).
- Проверки arch: `check`, unit/SSR, `test:classes`, затронутые браузерные сьюты.

### D. Drive (`refs/module-drive`) — после arch

**D1. Уведомления и `DriveBackLink`.**
- Drive-часть inline-уведомлений: `?notice=`/`shownNotice`, поле `notice`, `<p data-testid="drive-notice">`, `driveNoticeHref`, success-toast в `use-drive-operation` (§8a.1).
- `DriveBackLink`: `useInstance()` вместо `tryUseModals()`; регрессионный тест page-fallback и модалки.

**D2. Пикер «выбранные» (историческое имя — «этап 0»).** `Empty` уже создан в A3, поэтому здесь только `picked`/`mode`/`step` в `DrivePickerData`, `drive.ids` как срез шага (override `ids` → `driveFilterExtras` → `snapshot.extra`, включая `none`), `Steps` + `SurfaceControls` + `Checkbox`/`ListingRow` по образцу `UserPicker`, no-JS GET (см. §7a). Выполнять после arch (A1–A5).
   - **0.5. Разделение `picked` / `drive.ids` / `param`.** Зафиксировать три разных состояния и не смешивать их в одном поле:
     - `picked` — **UI-выбор multiple**: что отмечено в пикере, счётчик и чекбоксы; в модалке локальное, на странице — `?picked=`; предел 100. В `single` накопительного `picked` нет (один `id`/корень уходит в `param`). Само по себе не фильтрует список.
     - `drive.ids` — **производный срез списка** для шага `chosen`: `null` — без ограничения, `[]`/`none` — явно пустой набор, иначе ID в порядке `picked`; передаётся через `overrides.ids` и попадает в `snapshot.extra`. Не является результатом для вызывающего экрана.
     - `param` — **имя адресного ключа результата** на `from` (`target_id`, `ids` и т.п.): значение пишется только финальным выбором/Apply, а не при каждой отметке; для single — один UUID или явный `null` (корень), не пустая/невалидная строка; для multiple — список. В адресе пикера `param` хранит имя, а не выбранное значение.
     - Инварианты: `picked` не читается как `param`; `drive.ids` не добавляется в `from`; `param` не используется для среза списка; очистка `picked` очищает `drive.ids`/`upicks`; пустой `chosen` — `none`, а не отсутствие ключа. `chosenSlice`/`stepHref`/`applyHref` — три разные функции с разными входами.
     - Проверки: смена шага не меняет `param`; Apply не добавляет `drive.ids`; `picked=[]` + `chosen` → `drive.ids=none`; target в `from` не появляется до финального выбора/Apply.
   - **0.6. Семантика массового выбора.** Определить `multiple` как набор независимых ID, а не «выбрать всё по фильтру»:
     - `single` атомарен: выбор заменяет предыдущий, `chosen`/«Применить» нет; `multiple` копит `picked`, переключатель — `Checkbox` рядом с именем, не внутри ссылки.
     - В `multiple` навигация (имя папки, крошки, переход внутрь) не меняет `picked`; в `single` она не меняет target. Выбор папки/файла не навигирует. Выбор папки **не** выбирает её содержимое, выбор содержимого не выбирает родителя — каскада нет.
     - В `multiple` `picked` переживает пагинацию и переход по папкам в рамках пикера; выбранные не теряются при смене страницы. В `single` накопительного набора нет: target меняется только явным выбором. Отдельного «выбрать все» в этапе 0 нет: только явные отметки.
     - **`chosen` не наследует pick-фильтры, но сохраняет собственные при возврате.** `q`, `type`, датовые `from`/`to` — способ найти кандидатов в `pick`, а не часть выбранного набора. При обычном `pick → chosen` **унаследованные** фильтры не применяются к `drive.ids` (сбрасываются в текущем срезе), страница — 1; identity, `kind`, `mode`, `picked`, адресный `from`, `param` сохраняются. Если те же ключи есть в direct-URL `chosen` или пользователь применил их в самом шаге, это собственные фильтры `chosen`: они применяются к `drive.ids`, могут дать `chosen-hidden`, и для них работает «Сбросить фильтры». Нельзя превращать direct-URL `chosen` в безфильтровый экран. **Возврат `chosen → pick → chosen`:** при уходе в `pick` ставятся `filter_owner=chosen`, текущие фильтры и `picked` сохраняются; если в `pick` фильтры не менялись, `pick → chosen` сохраняет их как собственные; изменение любого фильтра в `pick` снимает маркер, и возврат сбрасывает уже pick-фильтры, не выдавая их за собственные. «Сбросить фильтры» в `chosen` меняет только собственные фильтры, ставит `page=1` и снимает `filter_owner=chosen`, сохраняя `picked`/`upicks`/`drive.ids`; скрытие из-за другой папки или недоступности сбросом не снимается. Иначе выбранный элемент исчезает из `chosen` только из-за унаследованного фильтра, которым его искали, и `hidden` растёт ложно.
     - Дедупликация по ID и порядок первого выбора действуют в `multiple`; лимит 100 — для `picked`/`drive.ids` в URL и для набора multiple. В `single` URL несёт один выбранный UUID или корень, а не `picked`; при 100 новая отметка в multiple не добавляется.
     - В `multiple` папка и файл выбираются одинаково (если `kind=any`); `kind=folder` оставляет только папки. Текущая папка/корень отдельными элементами набора не добавляются.
     - Проверки `multiple`: 0/1/100/101; снятие и повторная отметка; переход внутрь папки не сбрасывает набор; папка не тянет детей; `single` не показывает `chosen`; `pick → chosen` с активными `q`/`type`/датовыми `from`/`to` показывает все `picked` текущего среза и даёт `hidden=0`, а не `chosen-hidden`; direct-URL `chosen` с теми же ключами применяет их как собственные и при необходимости показывает `chosen-hidden` с рабочим сбросом фильтров; `chosen → pick → chosen` без правок сохраняет фильтры и `filter_owner=chosen`, а изменение фильтра в `pick` снимает маркер и не переносит эти фильтры обратно. `filter_owner` валиден только как ровно один `chosen`; `true`/`1`/`CHOSEN`/дубль отбрасываются без `400`, в `single` снимается; в `multiple` пагинация/переходы по папкам его сохраняют, сброс фильтров в `chosen` снимает; direct-URL `chosen` без маркера трактует фильтры как собственные. Ревизия после мутаций — §7a.9.
   - **0.7. Транспорт Apply.** Реализовать один транспорт результата:
     - no-JS — **GET** на валидированный `from` с `initial.param`; single — один UUID, а корень только при явном `id:null` (не пустая/невалидная строка; ключ удаляется), multiple — `picked.join(',')`; POST остаётся у операции move/copy, не у пикера.
     - JS-модалка — `onPick(id,label)` для single и `onPicked(ids,labels)` для multiple; `DriveTargetPicked` — дискриминированный union (§7a.2a), multiple/`ids` не попадают в move/copy. Single-guard move/copy: только `mode:'single'` без `ids`; отсутствующий/неверный `mode` игнорируется, невалидный/отсутствующий `id` не становится корнем, `id:null` — только явный корень.
     - Apply доступен только по `canApplyChosen` (§7a.2a): непустой multiple, известный `totalItems`, `hiddenCount===0`; пустой `chosen` показывает `Empty`, `chosen-hidden` блокирует Apply; single применяется сразу. `from`/`param` валидируются по §7a.6, `drive.ids` в целевой адрес не добавляется.
     - no-JS-ссылки в `single` не сохраняют `picked`/`upicks`/`drive.ids`/`filter_owner`: навигация несёт только `mode`/`kind`/`from`/`param` и текущую папку, target не меняется. `picked` допустим в `multiple` на `pick`/`chosen`, `upicks`/`drive.ids` — только в `chosen`, `filter_owner` — только в `multiple` (`pick`/`chosen`) и только со значением `chosen`.
     - Проверки: GET-ссылка/модальный callback, сохранение остальных query `from`, замена `param`, удаление `param` только при явном `id:null`, отказ при `mode=multiple`/`ids` у move/copy, игнорирование missing/wrong `mode`, невалидный `id` не даёт корень, лимит 100, `hidden>0` не даёт Apply; no-JS-ссылки single не содержат `picked`/`upicks`/`drive.ids`/`filter_owner`; в `multiple` навигация `pick` сохраняет уже стоящий `filter_owner`, а `single` его снимает.
   - **0.8. Единый codec состояния списка.** Один чистый слой вместо ручных сборок URL:
     - `DriveListState = { identity, filters, ids, page, pageSize }`; `decodeDriveList(searchParams, identity)` и `resolveDriveList(state, overrides)` плюс `encodeDriveListQuery(state)`/`encodeDriveListExtra(state)`.
     - `encodeDriveListExtra` возвращает только активные `q`/`ord`/`type`/`scope`/`from`/`to`/`ids` **без `_list`**: identity в `driveSnapshot` передаётся отдельным аргументом и не дублируется в `extra`. `encodeDriveListQuery` добавляет `drive`, `drive.size` и префикс `drive.*`, но **не `_list`**: identity — не адресный ключ.
     - `decodeDriveList` принимает identity из маршрута, валидирует фильтры через URL-схему, а `drive.ids` и страницу читает legacy-адаптерами `parseDriveIds`/`drivePageOf` (none/null/мусор/200 без overflow); `encodeDriveListQuery`/`encodeDriveListExtra` опускают умолчания, пишут `ids` только как `none`/список, страницу — только > 1. `_list` читается только из `snapshot.extra`/paginator.extra, не из URL: URL-схема `DRIVE_LIST_URL_SCHEMA` без `_list`, extra-схема `DRIVE_LIST_EXTRA_SCHEMA` с `_list`.
     - Один codec питает `driveSnapshot.extra`, `driveListHref`, `fetchDrivePage` и `stepHref` для `chosen`; `picked`/`upicks`/`mode`/`filter_owner`/`from`/`param` в него не входят — это отдельный codec пикера.
     - Запрещены ручные `drive.ids`/`drive.q`/`drive.size` в компонентах и повторная сборка `extra` из URL после override; `overrides.ids` проходит через тот же codec.
     - Проверки: round-trip `decodeDriveList(encodeDriveListQuery(state), identity)`; `ids=null` — ключа нет, `ids=[]` — `none`, до 200 ID читаются, 201-й отбрасывается без overflow; page 1/размер 30 не пишутся; `encodeDriveListExtra(state)` совпадает с query следующей страницы; `picked` не влияет на list codec.
     - Порядок: 0.5 → 0.6 → 0.8 → 0.9 → 0.7. Codec 0.8 нужен до защиты 0.9 и финального подключения Apply в 0.7; 0.8 не меняет семантику `picked`/`param`, только убирает ручные сборки.
   - **0.9. Защита от устаревших ответов.** Использовать `reqId`/`AbortController`/`prefetchGen` ядра, а не второй счётчик. `fetchDrivePage` принимает `signal`, проверяет его до/после `preloadData` и сверяет `driveListKey` снапшота с ожидаемым; чужой снапшот — `drive.list-stale`, отменённый — тихий `AbortError`. Picker-колбэки — монотонный `seq`, move/copy — только `mode=single` без `ids`, с UUID или явным `id:null`; missing/wrong `mode` и невалидный `id` игнорируются без подстановки корня; `picked`/`upicks`/`step` относятся только к `multiple`. Детали и тесты — §7a.8; выполнять после 0.8.
   - **0.10. Таксономия пустых состояний.** Сначала определить `DriveEmptyKind`/`DriveEmptySpec` и `driveEmptyOf` (дерево приоритетов), затем подключить `Empty` в слот `Listing`/`EmptyState`. Не писать отдельные `{#if}` на каждый экран. Детали и тексты — §7a.10; `filter_owner` не входит в `hasFilters`/`hasSearch` и не передаётся в `DriveEmptyInput`; он влияет только на сохранение/сброс фильтров при переходе, а `DriveEmptyKind`/`DriveEmptySpec` через `driveEmptyOf` определяются итоговыми фильтрами. Снятие маркера при сбросе фильтров — по §7a.4. Выполнять после 0.9, до финальной полировки списка.

**D3. Действия, гигиена, мобильный аудит.**
- `DriveNodeAction[]` — единый доменный дескриптор действий; внедрение `OverflowMenu` (`maxVisible` 2 на мобильном, 3–5 на десктопе, `mode="count"`).
- Гигиена: `min-w-0`/`truncate`/`title`, `gap` вместо `mt-*`/`my-4`.
- Мобильный аудит drive (§9a): `DriveFilters`, `DriveNodeCard`, крошки, detail-`dl`, футер фильтров.

**D4. Карточки, модалки и проверки.**
- `EntryCard`/`Item`/`Surface` в `DriveEntry`, `DriveFiltersPage`, detail-`DriveNodeCard`, `DriveDavTokensStep`; row → `Attachment` + `Item`. Только после D2.
- Модалки drive: `min-h-0 flex-1` + `p-4 sm:p-6`, ветка `card`/`plain`.
- Проверки drive: SSR/no-JS, `data-testid`, клавиатура, адаптивность, `test:classes`.

### 8.1. Проверка противоречий после укрупнения

- **Arch раньше drive.** A1–A5 не меняют payload; D1–D4 не начинаются до A5.
- **`Empty` до пикера.** A3 создаёт примитив, D2 его использует.
- **Паттерны и пикер.** A5 создаёт `Item`/`EntryCard`, D4 их подключает — только после D2, когда выбор и URL стабильны.
- **OverflowMenu.** A3 — примитив, D3 — доменный дескриптор и внедрение; не дубль.
- **Уведомления.** A1 закрывает arch-часть, D1 — drive-часть; разные ветки, один контракт.
- **Модалки и версии.** A2 не зависит от A3–A5, но идёт вторым: ошибки чанка классифицируются до переделки экранов.
- **Проверки.** A5 и D4 не пересекаются по файлам.
- **Настройки.** A4 зависит от A4-rail (внутри этапа), внешних зависимостей нет.


---

## 8a. A1: Toast — только клиентские сбои

**Сервер уведомлений не показывает.** Результат операции — навигация или квитанция формы; ошибка — в форму (`Field`, `Alert` внутри формы), а не отдельным маршрутом и не плашкой над страницей. Inline-объявления из UI убираем, cookie-транспорт не вводим.

Toast — единственное исключение, и только на клиенте: событие, для которого нет экрана и которое нельзя вернуть в форму.

- потеря сессии посреди работы;
- неожиданная блокировка или отзыв права;
- сеть недоступна;
- чанк или билд не доехал (§8b).

Без JS toast не показывается: такие события проявляются штатной ошибкой формы или страницы при следующем действии. Ни `<noscript>`-баннера, ни слота в каркасе, ни `?notice=`.

### 8a.0. Аудит: куда сейчас уходят ошибки

Проверено `#core/lib/form` (`result.ts`, `submit.ts`, `server.ts`, README «Исходы отправки») и все `redirect(...)` в `src`.

**Модель библиотеки уже правильная:** `not-applied` → ошибки рендерятся в форме (`renderInlineWithResult`), `fail(...)` → `Result.errors` и статус, `redirect` — только при `ok` и `committed`. Обработчик `componentFormsHandle` сам различает эти ветки (`core/hooks/component-form/server.server.ts:709–721`), включая `redirectOnSuccess: 'inline'`.

**Редиректов-ошибок в коде нет.** Все 13 мест с `redirect(` срабатывают только при `result.ok` (успех) либо когда экшена нет (`schema`: `if (!handled)`). Переименование устройства (`session-card`) и правка чужой сессии (`account-session`) уже возвращают `fail(...)` — это эталон.

**Что реально нашлось:**

| Место | Что это | Решение |
|---|---|---|
| drive `?notice=drive.notice-done` | маркер **успеха** в PRG | убрать (успех — просто навигация) |
| sessions `?notice=bulk-exit-partial&requested&revoked` | **частичный успех**, числа из адреса | не ошибка: вернуть `{ requested, revoked }` в `Result.data`, показать `Alert` из результата формы; без query-ключей |
| `?notice=rename-failed` в `session-card`/`account-session` | **мёртвый код**: парсится и рисуется, но никто его не выставляет (rename уже `fail`) | удалить парсинг, тип `notice` и блок в `SessionCard` |
| schema `?done=1` → `justDone` | маркер успеха; `justDone` нигде не используется | удалить |

**Правило на будущее:** ошибка операции — только `fail(...)`/`Result.errors` в форму; частичный успех — типизированные данные в `Result.data` и `Alert` рядом с формой; успех — навигация. `redirect` не несёт ни ошибок, ни чисел.

### 8a.1. Что убрать из кода

Разделение по репозиториям: arch-часть — этап A1 (`refs/core`), drive-часть — этап D1 (`refs/module-drive`).

- drive: `?notice=` и `shownNotice` в `sections/drive/load.server.ts`, `notice` в `DriveListRouteData`/`DriveOperationData`/`DrivePickerData`, `<p data-testid="drive-notice">` в `DriveBrowse`, `driveNoticeHref`, а также `notify(\`${spec.title}: выполнено\`)` в `use-drive-operation.svelte.ts` — успешных тостов нет.
- user/sessions: `?notice=bulk-exit-partial&requested&revoked` и `noticeOf` в `sessions-list/load.server.ts`; `runBulkExit` (`modules/user/sessions/service/sessions-exit.server.ts`) возвращает `redirect` с query — заменить на `{ data: { requested, revoked } }`, а список показывает `Alert` из результата формы.
- user: `?notice=rename-failed` в session-card/account-session (мёртвый код) и `?done=1`/`justDone` в schema.
- Тесты, которые проверяют эти адреса, переписать: успех — навигация без плашки, ошибка — в форме, частичный успех — `Result.data`.

### 8a.2. Куда возвращать ошибку

- Ошибка операции — ошибка `Field` или `Alert` внутри формы/модалки, рядом с кнопкой; страница не уходит на отдельный маршрут.
- Частичный успех группы (bulk-сессии) — тот же экран списка, `Alert` с числами из ответа, без query-ключей.
- Успех — навигация или закрытие модалки. Отдельного «выполнено» нет.

### 8a.3. Контракт toast

- Только клиент: `notify(...)` вызывается из обработчиков и эффектов, никогда из `load`/`execute`.
- Слой выше модалок: `NoticeHost` с `z` больше 210, иначе тост из модалки не виден (сейчас `z-100` ниже backdrop `z-200`).
- Дедупликация по `text + tone`, повтор продлевает таймер, а не игнорируется.
- Максимум 3 плашки; новая вытесняет старую.
- Один `aria-live="polite"` на контейнере; у элементов нет своего `role="status"`, иначе двойное чтение.
- Таймеры очищаются при размонтировании и на `visibilitychange`.
- Никаких success-тостов об операциях: это косметика без функции.

### 8a.4. Проверки

- Успешная операция не показывает тост и не пишет `?notice=`.
- Ошибка операции видна в форме или модалке, отдельного маршрута нет.
- No-JS: ошибка формы видна, тостов нет.
- Тост, показанный при открытой модалке, виден поверх неё.
- Одинаковые события не дублируются; разные тона одного текста не схлопываются.

## 8b. A2: модалка по готовности и принудительный перезапуск

Симптом: кнопка показывает лоадер, модалка открывается со скелетоном и догружается внутри; после долгого фона вкладки ленивые компоненты не грузятся до перезапуска сайта.

### 8b.1. Что уже есть

- `lazy(() => import('./X.svelte'))` + `ensureModalComponent` (`core/lib/modals/svelte/component.svelte.ts`): готовность = данные **и** чанк; неудачный импорт не кешируется, повтор при следующем открытии.
- `loader.ts` ждёт `ensureView` вместе с данными, ставит `status:'error'` и репортит причину; кнопка уже умеет состояние ошибки.
- SvelteKit 3.0.1 сам умеет версии: `x-sveltekit-version` в ответах `load`/actions, проверка на focus/visibility, полная навигация при ошибке загрузки и смене версии, `updated.current`/`updated.check()` из `$app/state`, `kit.version.name`/`pollInterval`.

### 8b.2. Контракт открытия

- Клик → `preloadModal` (данные + чанк) → **только при успехе** открывается модалка. Кнопка: `idle → loading → error`; повторный клик из `error` повторяет загрузку.
- Предзагрузка на hover для ленивых модалок не используется (`data-sveltekit-preload-data="hover"` на `<body>` не должен открывать модалку и не должен подменять клик).
- Ошибка остаётся на кнопке; модалка не открывается. Причина уходит в `onError`.

### 8b.3. Классификация сбоя

- `chunk-stale` — 404 или `Failed to fetch dynamically imported module`: билд сменился, повтор того же импорта бесполезен.
- `network` — обрыв или таймаут: повтор осмыслен.
- `data` — ошибка загрузчика маршрута, к чанку отношения нет.

### 8b.4. Смена билда: принудительный перезапуск

В нашем сценарии выбираем **принудительный reload**, а не toast и не предложение обновиться. Причина: старые чанки не грузятся, навигация и отправка формы бьются в мёртвые адреса, и ожидать действия пользователя бессмысленно — он в этот момент может отправлять форму в никуда.

- Условия срабатывания: `updated.current === true` **или** подтверждённый `chunk-stale`.
- Действие: `location.reload()` на текущий адрес, не `goto` и не переход на главную.
- Guard: ключ в `sessionStorage` по версии билда — один reload на версию; повторный сбой той же версии не циклит, а показывает текст ошибки.
- `kit.version.name` — детерминированный (commit sha), не `Date.now()`; `pollInterval` — 60 000 или `0`, если хватает проверок на focus/visibility.
- Несохранённые данные формы при reload теряются; это принятая цена против мёртвого интерфейса, но reload не запускается, пока идёт активный `submit` (сначала даём ему завершиться или упасть).

### 8b.5. Проверки

- Отклонённый импорт → модалка не открывается, кнопка в `error`, повтор запускает новую попытку.
- `chunk-stale` → ровно один `reload` на версию, второй раз не перезагружает (guard).
- `updated.current` после смены версии → reload без ожидания действия пользователя.
- Успешный клик: модалка появляется сразу с содержимым, без кадра со скелетоном.
- Hover не открывает модалку и не подменяет клик.

## 9. A5: мобильный аудит базовых UI-компонентов

Цель этапа — привести **base UI** к мобильному поведению: меньше фиксированных ширин/отступов, корректные скроллы, touch-target, единый вид и чистый UnoCSS. Глобальные `p-6` у `Surface`/`Card` **не меняем** — адаптивный `p-4 sm:p-6` задаётся точечно в drive через `class`. A5 идёт после A3 и до D4 (карточки drive).

### 9.1. Что проверено

`Surface`, `SurfaceBar`, `Card` (+`CardHeader`/`CardContent`/`CardFooter`), `Alert`, `Button`/`ButtonGroup`, `Badge`, `Attachment`/`FileAttachment`, `Floating`, `Listing`, `Paginator`/`PageNav`/`SearchBar`, `Field`/`Common`, `MODAL_POPUP_CLASS`/`MODAL_SKELETON_CLASS`/`MODAL_ERROR_CLASS`.

### 9.2. Находки

| Компонент | Проблема | Влияние |
|---|---|---|
| `Surface` (card) | Глобальный `p-6` **не трогаем**; на мобильном в drive нужен `p-4` | Иначе поедут все страницы сайта; меняем только drive-вызовы через `class` |
| `CardHeader`/`CardContent`/`CardFooter` | Глобальный `p-6` **не трогаем**; в drive-карточках нужен адаптивный | `EntryCard`/detail передают `p-4 sm:p-6` в свои экземпляры, а не в примитив |
| `SurfaceBar` | В коде нет скрытия скроллбара, хотя README его обещает; зоны не скроллятся отдельно | На мобильном видимая полоса прокрутки и расхождение с документацией |
| `SearchBar` | `mb-3` (нарушает `gap`-гигиену) + `min-w-56` | Двойной отступ в `Listing`; на 320 px поиск + «Найти» могут не влезть |
| `PageNav` | `ButtonGroup` без `overflow`; номера страниц + счётчик + `ResetButton` | На мобильном ряд вылезает за экран; `mt-2` даёт двойной отступ |
| `PageLink` | `size="sm"` (32 px) | Ниже рекомендуемого touch-target 44 px |
| `Badge` | `whitespace-nowrap` без `max-w-full` | Длинный статус распирает строку |
| `FileAttachment` (`strip`) | `overflow-x-auto` без скрытия скроллбара | Видимая полоса под карточками на мобильном |
| `Floating` (меню) | Пункты не задают touch-height | Мелкие клики в `OverflowMenu` |
| `PaginatorSettings` | `p-4` на мобильном | Можно `p-3 sm:p-4`, чтобы не терять ширину |
| `MODAL_SKELETON_CLASS`/`MODAL_ERROR_CLASS` | `p-6` | На мобильном лишний отступ; drive-модалкам padding уже даёт оболочка, отдельный класс не нужен |
| `Attachment` (tile) | Фиксированные `w-28`/`w-44`, действия поверх медиа | На узком экране две плитки ещё влезают, но действия могут перекрывать превью |
| `Listing` | `SearchBar` + `Surface` body `gap-4` + `mb-3` | Ритм отступов разъезжается |

### 9.3. Предлагаемые изменения

| Компонент | Изменение | Эффект |
|---|---|---|
| `Surface` | **Глобально оставить `p-6`**; в drive на `variant="card"` передавать `class="p-4 sm:p-6"`, в `plain` — без класса | Меньше отступов только у drive-экранов; `twMerge` перекрывает базовый `p-6` |
| `CardHeader`/`CardContent`/`CardFooter` | **Глобально оставить `p-6`**; drive-карточки, использующие `CardHeader` напрямую, передают `class="p-4 sm:p-6"` (у Content/Footer — `pt-0`). `EntryCard` `CardHeader` не использует — его padding задаётся на корневом `Card` | Примитив остаётся нейтральным; ритм задаёт drive |
| `DrivePage`/`DriveBrowse` | `DriveBrowse` передаёт в `Listing` `class="p-4 sm:p-6"` только при `variant="card"`; в пикере/модалке `plain` — без класса | Не двоить padding модалки; отдельный `class`-prop `DriveBrowse` не нужен |
| `DriveNodePage`/`DriveAccessPage`/`DriveFiltersPage` | `Surface variant="card" class="p-4 sm:p-6"` | Страничные карточки drive, не глобальный `Surface` |
| `DriveEntry` | `<EntryCard class="p-4 sm:p-6">` | Базовый `p-6` перекрывается через `cn`/`twMerge`; отдельный `padding`-проп не нужен |
| `DriveNodeCard` (detail) | `Card class="p-4 sm:p-6"` | У `Card` нет своего padding — класс безопасен |
| `DriveDavTokensStep` | `Card`/`Surface` с `class="p-4 sm:p-6"` | Вместо ручного `div` с `p-6` |
| `SurfaceBar` | Добавить `[scrollbar-width:none] [&::-webkit-scrollbar]:hidden` контейнеру; README привести к фактическому поведению (контейнер скроллится, зоны — нет) | Убирает видимую полосу; документация перестаёт врать |
| `SearchBar` | Убрать `mb-3`; `wrapperClass="min-w-0 flex-1 basis-full sm:basis-auto"`; кнопки `max-sm:w-full` | Поиск занимает строку на мобильном,submit/clear не вылезают |
| `PageNav` | Обернуть `ButtonGroup` в `max-w-full overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden`; `pb-[max(8px,env(safe-area-inset-bottom))]`; убрать `mt-2` в пользу `gap` родителя | Номера страниц скроллятся, а не ломают layout; safe-area на iOS |
| `PageLink` | На `max-sm` — `min-h-10 px-2.5` (через `class`) | Крупнее touch-target без изменения десктопа |
| `Badge` | `max-w-full min-w-0`; длинные подписи — `title` у потребителя | Бейдж не распирает строку |
| `FileAttachment` | `strip`: `[scrollbar-width:none] [&::-webkit-scrollbar]:hidden`; опционально `snap-x snap-mandatory` | Чистая полоса карточек |
| `Floating`/`OverflowMenu` | Пункты меню: `min-h-11 sm:min-h-9`, `px-3`; иконки `size-4` | Удобные тапы на мобильном |
| `PaginatorSettings` | `p-3 sm:p-4` | Больше ширины полям |
| `MODAL_SKELETON_CLASS`/`MODAL_ERROR_CLASS` | `p-4 sm:p-6` — отдельное решение для модальных классов; `Surface`/`Card` не трогаем | Меньше отступа в модалках; drive-экраны это не дублируют |
| `Attachment` (tile) | На `max-sm` действия — `size="icon-sm"`, медиа не перекрывать; при необходимости `w-24` | Плитки остаются читаемыми |
| `Listing` | После `SearchBar` убрать `mb-3`; отступы — `gap-4` тела `Surface` | Единый вертикальный ритм |

### 9.3a. Проверка класса по фактическому коду

- `core/ui/surface/Surface.svelte:126`: `class={cn('flex min-h-0 flex-col', variant === 'plain' && 'flex-auto', surfaceVariants({ variant }), cls)}` — `surfaceVariants({ variant: 'card' })` даёт `p-6`, а `cls` идёт последним.
- `core/ui/utils.ts`: `cn()` — это `twMerge(clsx(...))`; `tailwind-merge` снимает конфликтующий `p-6`, когда следом идёт `p-4 sm:p-6`. Итог: `p-4 sm:p-6`, а не два padding.
- `core/ui/listing/Listing.svelte:346`: `class={cn('min-h-0', className)}`; `ListingProps.class` объявлен в `core/ui/listing/types.ts:78`.
- `modules/drive/ui/DriveBrowse.svelte:274`: `<Listing …>` уже принимает `class`; достаточно добавить `class={variant === 'card' ? 'p-4 sm:p-6' : undefined}` прямо в этот вызов. Новый prop `DriveBrowse` не нужен.
- В `plain` (модалка, пикер) класс не передаётся — padding уже даёт оболочка. В `Listing`-ветке `frame` класс игнорируется; `DriveBrowse` сейчас `frame` не использует, если появится — padding задаёт родитель.
- `EntryCard`: `class` идёт на корневой `Card` последним, базовый `p-6` — часть его же класса. `<EntryCard class="p-4 sm:p-6">` перекрывает `p-6` тем же `twMerge`; `padding`-проп и `cardClass` не нужны.
- Расхождения с планом нет: цепочки `surfaceVariants` → `Listing.class` → `Surface.cls` и `EntryCard.class` → `Card.class` работают через `twMerge`.

### 9.4. UnoCSS-проверка этапа

- Все новые классы — штатный `presetWind4`: `p-4 sm:p-6`, `max-sm:w-full`, `min-h-11`, `basis-full`, `[scrollbar-width:none]`, `[&::-webkit-scrollbar]:hidden`.
- `max-sm:`/`sm:` — стандартные breakpoints; `min-h-11` — 44 px touch-target.
- Никаких `space-*`, `dark:*`, палитровых классов и динамических строк.
- `SurfaceBar`/`SearchBar`/`PageNav` не получают новых `shortcuts` — только утилиты.

### 9.5. Риски этапа

- Глобальные `p-6` в `Surface`/`Card` не меняются; проверяем только drive-экраны и не добавляем `p-4 sm:p-6` в `plain`-модалки, где padding уже даёт оболочка.
- `class` у `Surface`/`Listing` должен идти после вариантов (`cn`/`twMerge`), иначе базовый `p-6` может победить.
- `PageNav` с горизонтальным скроллом может конфликтовать со `sticky`; проверить на iOS Safari.
- `SurfaceBar` — выбрать одно: либо скрыть скроллбар (минимально), либо реализовать скролл зон и обновить README; не делать оба.
- `Badge` с `max-w-full` может обрезать статус — в drive передавать `title`.

---

## 9a. Мобильный аудит drive: ширины, переносы, overflow

Проверены все 43 `.svelte` в `modules/drive/ui` (поиск по всем, ключевые прочитаны целиком), включая модалки-носители, и общий `operation/DriveOperationShell.svelte`; поиск — `w-*`, `min-w-*`, `max-w-*`, `basis-*`, `grid-cols-*`, `overflow-*`, `whitespace-*`, `flex-wrap`, `truncate`, `shrink-*`, `break-*`. Новых фиксированных `w-*` не найдено: остались `basis-44`/`basis-56`, `grid-cols-[auto_1fr]` и безопасный `w-full`; `basis-*` и массовые `p-6` уже закрыты в §8.6/§9, `DriveEntry p-6`/`my-4` — в §8.5/§8.7. Ниже — только **оставшиеся** риски.

### 9a.1. Таблица

| Файл:строки | Текущий класс / риск | Что сделать |
|---|---|---|
| `DriveBrowse.svelte:243` | Корень `flex min-h-0 flex-1 flex-col gap-3` без `min-w-0` | `min-w-0`, иначе длинная строка/крошки распирают flex-родителя |
| `access/DriveAccess.svelte:46`, `DriveDavTokens.svelte:36`, `DriveDavTokensStep.svelte:17`, `DriveNodeCard.svelte:67,82`, `filters/DriveFilters.svelte:112`, `operation/DriveOperationShell.svelte:44` | Корни `flex flex-col`/`flex flex-wrap`/`flex w-full` без `min-w-0` | Добавить `min-w-0` этим контейнерам; иначе дочерний длинный текст/`dl` распирает их по `min-width: auto` |
| `DriveBrowse.svelte:255-266` | `<nav class="flex flex-wrap items-center gap-1 text-sm">`; ссылки `<a class="hover:underline">` без `min-w-0`/`truncate`/`max-w-full` | Длинное имя папки не переносится внутри ссылки и вылезает; добавить `min-w-0` корню, ссылкам — `min-w-0 max-w-full truncate` (или `break-all`) + `title={crumb.name}`, разделителям — `shrink-0` |
| `DriveBrowse.svelte:311-345` | `controls()`: 7 кнопок + `Badge` (quota); `SurfaceBar` end-зона `whitespace-nowrap`, кнопки `shrink-0` | На мобильном ряд уходит в горизонтальный скролл без индикатора; `OverflowMenu` (этап 10) или `max-sm:flex-wrap max-sm:justify-start`, `Badge` — `shrink-0` |
| `DriveBrowse.svelte:349-372` | Пикер-строка `flex flex-wrap`; имя `min-w-0 flex-1 truncate` — ок; `<span class="text-xs text-muted-foreground">` с размером без `shrink-0 whitespace-nowrap` | Размер/«папка» может переноситься и выдавливать кнопку; добавить `shrink-0 whitespace-nowrap` |
| `DriveNodeCard.svelte:67-77` | Detail: `dl class="grid grid-cols-[auto_1fr] …"`, `dd` без `min-w-0 break-words` | Длинный `contentType`/дата распирают карточку; `grid-cols-1 sm:grid-cols-[auto_1fr]`, `min-w-0` и `break-words` на `dd` (или `DescriptionList` из §10) |
| `DriveNodeCard.svelte:83-95` | Row: `flex flex-wrap` + `basis-56`; `DriveNodeLinks` (`flex flex-wrap`, до 7 кнопок) | `basis-56` → `min-w-0 flex-1` (уже §8.6); действия — `OverflowMenu`; иначе на 320 px строка превращается в 3–4 ряда кнопок |
| `DriveNodeLinks.svelte:45` | `flex flex-wrap items-center gap-1`; 5–7 `Button` с `shrink-0` | Не overflow, но высота строки растёт; `OverflowMenu` + `maxVisible`, primary-действия оставить снаружи |
| `access/DriveAccess.svelte:47-55` | Заголовок `flex flex-wrap items-start justify-between`; левый `<div>` без `min-w-0`; `h2` содержит `data.node.name` | Длинное имя узла распирает заголовок; `min-w-0` на `<div>`, `break-words` на `h2` (без обрезки имени) |
| `DriveDavTokens.svelte:49-56` | `dl class="grid grid-cols-[auto_1fr] …"`; `dd` без `min-w-0 break-words` | Тот же риск, что в detail; `grid-cols-1 sm:grid-cols-[auto_1fr]` + `min-w-0 break-words` (или `DescriptionList`) |
| `DriveDavTokens.svelte:74-77` | `font-mono` префикс без `break-all`; строка `Создан … · использован …` без `min-w-0 break-words` | Длинный prefix/две даты на 320 px вылезают; `break-all` префиксу, `break-words min-w-0` строке дат |
| `DriveDavTokensStep.svelte:17-23` | `flex flex-wrap`; левый `<div class="flex flex-col gap-1">` без `min-w-0` | Длинный текст/будущий uid распирает шаг; `min-w-0` и `break-words` |
| `filters/DriveFilters.svelte:121-142` | Четыре поля в `flex flex-wrap` с `min-w-0 flex-1 basis-44` | `basis-44` (176 px) на 320 px оставляет поля узкими/ломает даты; `grid grid-cols-1 sm:grid-cols-2` + `min-w-0` (уже §8.6, здесь точные строки) |
| `filters/DriveFilters.svelte:147-156` | Футер `flex items-center justify-between gap-3 pt-1` без `flex-wrap` | Две кнопки `shrink-0` могут вылезти в узкой модалке/сайдбаре; `flex-wrap` + `max-sm:w-full` для кнопок |
| `move/DriveMove.svelte:75`, `copy/DriveCopy.svelte:76` | `<p class="text-sm text-muted-foreground" data-testid="drive-target-label">` без `min-w-0 break-words` | Длинное имя папки-цели вылезает; `min-w-0 break-words` (и `title` у потребителя) |
| `operation/DriveOperationShell.svelte:47-50` | `<h2>`/`<p>` без `break-words`; внешний `div` без `min-w-0` | Длинный заголовок/описание операции может распереть форму; `min-w-0` + `break-words` |
| `DrivePicker.svelte:29` | Корень `flex min-h-0 flex-1 flex-col` без `min-w-0` | Child `DriveBrowse`/`Listing` может выйти по ширине; `min-w-0` |

### 9a.2. Проверено — правки не нужны

- `DriveBrowse.svelte:351,355` — имя в пикере уже `min-w-0 flex-1 truncate`.
- `DriveNodeCard.svelte:55-60` — имя `truncate`, метаданные `shrink-0`; detail-строка защищена.
- `access/DriveAccess.svelte:67-72` — строка доступа `flex-wrap` + левый `min-w-0` + `truncate`/`title`.
- `DriveDavTokens.svelte:66-68` — `li` и левый блок уже `flex-wrap`/`min-w-0`; остаётся только текстовая часть из таблицы.
- `share/DriveShare.svelte:116-124` — `Input` уже `min-w-0 flex-1`, кнопка в `flex-wrap`.
- `dav-issue/DriveDavIssue.svelte:41` — токен `block w-full break-all`.
- `DriveNodeLinks`/`DriveOperationShell` футеры уже `flex-wrap`; вопрос только в высоте/меню, не в overflow.

### 9a.3. Порядок правок

1. `min-w-0` на корнях из таблицы: `DriveBrowse`, `DrivePicker`, `DriveAccess`, `DriveDavTokens`, `DriveDavTokensStep`, `DriveNodeCard`, `DriveFilters`, `DriveOperationShell` — дешёво и убирает каскадные распирания.
2. Текст: крошки, `Access h2`, target-label, `dd`/даты, `DriveDavTokensStep`.
3. Сетки: `DriveFilters` (`grid-cols-1 sm:grid-cols-2`) и detail-`dl` (`grid-cols-1 sm:grid-cols-[auto_1fr]`).
4. Тулбары: `DriveBrowse controls` и `DriveNodeLinks` — только после `OverflowMenu`; до него не плодить ручные меню.

---

## 10. Аудит повторяющихся паттернов (arch + drive)

Проверены `core/ui`, `modules/drive`, а также соседние `modules/user` и `storage-servers`, потому что они используют те же классы в тех же сценариях. Цель — не тащить доменные обёртки в drive, а поднять повтор в `#core/ui` в духе shadcn: `Card`, `Item`, `Empty`, `DescriptionList`, `FormMessage`.

### 10.1. Карта повторов

| Сценарий | Где повторяется | Масштаб | Целевой компонент |
|---|---|---|---|
| Карточка-вход на главной | `DriveEntry`, `UserEntries`, `StorageServersEntry`, `SeedUsersEntry`, `HomePage` | 5 точных копий `rounded-xl…p-6` + `h2` + `p.my-4` + `Button` | `EntryCard` (тонкая композиция `Card`) |
| Карточка страницы/формы | 11 route-файлов `/drive/*`, `/user/config/dav/{issue,revoke}`, `sections/*/filters`, `AccountSessionPage`, `SessionCardPage` | ~19 копий `div.rounded-xl…p-6` | `Surface variant="card"` (уже есть); в drive — `class="p-4 sm:p-6"`, остальные — без изменения padding |
| Строка ресурса/списка | `DriveDavTokens` (пароль), `DriveAccess` (доступ), `StorageServerCard`, `Acl` (детали), `ConfigGroupStep` (2 варианта) | 6+ `rounded-lg border` + `flex justify-between` + действие справа | `Item` family (`Item`, `ItemContent`, `ItemTitle`, `ItemDescription`, `ItemActions`) |
| Пустое состояние | `Acl` (Empty-паттерн вручную), `UserConfig` (нет ключей), `StorageServersView`, `DriveDavTokens`, `DriveAccess` | 5 ручных заглушек | `Empty` (см. §3a) |
| Список фактов | `DriveDavTokens` (адрес/логин), `DriveNodeCard` (вид/создан), `ProfileCard`, `SessionCard` | 4 копии `dl.grid.grid-cols-[auto_1fr]` | `DescriptionList` (+ `DescriptionListItem`) |
| Инлайн-ошибка формы | `DriveFilters`, `SessionsFiltersForm`, `SeedUsersFiltersForm`, `BlocksFiltersForm`, `SessionCard` | 5 копий `p.text-sm.text-destructive[role=alert]` | `FormMessage` в `#core/ui/form` |
| Ссылка-кнопка в шапке | `UserConfig` (3 ссылки `security`/`sessions`) | 3 копии ручного `inline-flex…border…hover:bg-muted` | `Button href variant="outline" size="sm"` |
| Табличная строка с ячейками | `BlockCard`, `SeedUserCard` | 2 копии `flex w-full items-baseline gap-3 rounded-md px-2 py-2` + `cell` | `DataRow`/`RowCell` — кандидат после `Item` (не в первом заходе) |

### 10.2. Что создать в ядре

#### 10.2.0. Сверка с фактическим API `core/ui`

Проверено по `src/core/ui/index.ts` и файлам примитивов. **Ни одного из четырёх компонентов §10.2 в ядре пока нет**; ниже — что можно переиспользовать, что пересекается и где контракт надо поправить.

| Компонент §10.2 | В ядре | Что уже есть | Пересечение / пробел | Решение |
|---|---|---|---|---|
| `EntryCard` | нет | `Card` (`variant: 'default' \| 'muted'`, `class` последним), `CardDescription`, `Button` | `Surface variant="card"` тоже даёт карточку-поверхность с `title`/`description`, но это экранный каркас с `SurfaceBar`, а не домашняя карточка-вход. `Card` не ставит `data-slot` | Создать `EntryCard`; не дублировать `Surface` и не добавлять новый вариант `Card` |
| `Item` family | нет | `Attachment` (`layout="row"`, media/title/description/actions) | `Attachment` — файловая строка с `normalizeAttachment`, выбором и прогрессом; для токенов/доступов/конфига она слишком тяжёлая. Готового `Item`/`ItemGroup` нет | Создать отдельное семейство; `Attachment` не переделывать и не наследовать от него |
| `DescriptionList` | нет | 4 доменных `<dl>` в `ProfileCard`, `DriveDavTokens`, `DriveNodeCard`, `SessionCard`; ещё один — `SchemaValues` в core; `fieldsLayoutVariants({ layout: 'values' })` | `Stat` — карточка с одним крупным значением, не пары «подпись/значение». Общего `dl`-примитива нет | Создать `DescriptionList`/`DescriptionListItem`; `Stat` не использовать |
| `FormMessage` | нет | `Common` (`Alert variant="destructive"`), `FieldShell` (`f.errorProps()`, `text-xs font-medium`) | `form/` не имеет `index.ts`; `FormMessage` не должен заменять `Common` (общие ошибки) и `FieldShell` (ошибки поля) | Создать только inline/range-сообщение; экспорт — напрямую из `core/ui/index.ts` |

**Что подтверждено фактическим API:**

- `Card` уже принимает ровно `variant: 'default' | 'muted'`, а `class` попадает в `cn(cardVariants(...), cls)` последним — перекрытие `p-4 sm:p-6` с базовым `p-6` работает без нового пропа.
- `Card` — `<div>` с `HTMLAttributes<HTMLDivElement>`; контракт `EntryCard` должен использовать тот же тип, а не `HTMLAttributes<HTMLElement>`.
- `CardDescription` — `<p class="text-sm text-muted-foreground">`; `EntryCard` может добавить `leading-relaxed` через `class`, не создавая второй `<p>`.
- `Attachment` уже имеет `data-slot="attachment"`, `data-layout`, `data-size` и собственные `actions`; это не `Item`, смешивать их нельзя.
- `Surface` — `<section>` с `title`/`description`/`controls`; `EntryCard` остаётся на `Card`, иначе домашние карточки получат лишний `SurfaceBar` и другое поведение скролла.
- `Alert` по умолчанию ставит `role="alert"`, но переданный `role` идёт после статического и побеждает; `Common` уже использует `Alert` для общих ошибок.

**Правки контрактов по итогам сверки:**

1. `EntryCardProps` наследует `HTMLAttributes<HTMLDivElement>` (как `Card`), а не `HTMLElement`. Остальной контракт не меняется.
2. `DescriptionListProps` наследует `HTMLAttributes<HTMLDListElement>`: корень всегда `<dl>`, динамического `as` нет.
3. `DescriptionListItem` остаётся парой `<dt>`/`<dd>` без обёртки; `data-testid` и `title` — на `<dd>`, как и записано.
4. `FormMessage` остаётся на `HTMLAttributes<HTMLParagraphElement>`; `class` и явный `role` идут после вариантных значений. `form/index.ts` не создаётся — экспорт из корневого `core/ui/index.ts`.
5. `ItemMedia` — `<span>`, `ItemContent`/`ItemActions` — `<div>`; это новые компоненты, фактических ограничений ядра на них нет.

#### 10.2.1. `EntryCard`

Файл: `src/core/ui/card/EntryCard.svelte`. Заменяет 5 копий карточек-входов, не меняя вид.

```ts
type EntryCardVariant = 'default' | 'muted'

interface EntryCardProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title: string
  description?: string
  /** Основные действия под описанием. */
  actions?: Snippet
  /** Дополнительный блок под действиями (например, dev-кнопка). */
  footer?: Snippet
  /** Бейдж рядом с заголовком. */
  badge?: Snippet
  variant?: EntryCardVariant
}
```

- `variant`: `default` → `Card variant="default"`; `muted` → `Card variant="muted"`.
- Отдельного `padding`-пропа нет: `class` идёт на корневой `Card` последним, базовый `p-6` перекрывается drive-вызовом `class="p-4 sm:p-6"` через `cn`/`twMerge`.
- Разметка: `<Card class={cn('flex flex-col gap-4 p-6', className)} role="region" aria-labelledby={titleId}>` → `h2.text-xl` + `badge` → `<CardDescription class="leading-relaxed">` → `actions` (`flex flex-wrap items-center gap-2`) → `footer` (`flex flex-col gap-2 pt-1`).
- `title` — всегда `h2` (`text-xl font-semibold tracking-tight`), как в текущих пяти карточках; `titleId = $props.id() + '-title'`.
- `data-slot="entry-card"`, `data-variant`; `data-testid` и остальные HTML-атрибуты — на `Card`.
- `CardHeader` в `EntryCard` не используется: его глобальный `p-6` не затрагивается, а адаптивный padding задаёт сам `EntryCard` через `class`.
- `Card` уже содержит `rounded-xl border border-border bg-card text-card-foreground shadow-sm`; `EntryCard` не повторяет эти классы, а добавляет только раскладку и `p-6`.
- `Card` не выставляет `data-slot`; `data-slot="entry-card"` ставит сам `EntryCard` на корневой `Card`.
- Экспорт: `export { default as EntryCard } from './card/EntryCard.svelte'` в `src/core/ui/index.ts`.

```svelte
<EntryCard
  title="Диск"
  description="Папки и файлы с квотой, корзиной и доступом."
  data-testid="drive-entry"
>
  {#snippet actions()}
    <Button {...asModalLink('drive.browse')}>Открыть диск</Button>
  {/snippet}
</EntryCard>
```

#### 10.2.2. `Item` family

Файлы: `src/core/ui/item/ItemGroup.svelte`, `Item.svelte`, `ItemMedia.svelte`, `ItemContent.svelte`, `ItemTitle.svelte`, `ItemDescription.svelte`, `ItemActions.svelte`, `index.ts`.

```ts
type ItemVariant = 'default' | 'outline' | 'muted'
type ItemSize = 'sm' | 'md' | 'lg'

interface ItemGroupProps extends HTMLAttributes<HTMLElement> {
  as?: 'div' | 'ul'          // default: 'div'; div → role="list", ul → без role
  gap?: 'sm' | 'md' | 'lg'   // default: 'md'
}

interface ItemProps extends HTMLAttributes<HTMLElement> {
  as?: 'div' | 'li' | 'article' // default: 'div'; div/article → role="listitem", li → без role
  variant?: ItemVariant           // default: 'outline'
  size?: ItemSize                 // default: 'sm'
  interactive?: boolean           // default: false
  selected?: boolean              // default: false
}

interface ItemMediaProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'muted'   // default: 'default'
  size?: 'sm' | 'md'              // default: 'sm'
}

interface ItemContentProps extends HTMLAttributes<HTMLDivElement> {}

interface ItemActionsProps extends HTMLAttributes<HTMLDivElement> {
  align?: 'start' | 'end'         // default: 'end'
}

interface ItemTitleProps extends HTMLAttributes<HTMLElement> {
  as?: 'div' | 'span' | 'h3'      // default: 'div'
  truncate?: boolean              // default: false
}

interface ItemDescriptionProps extends HTMLAttributes<HTMLElement> {
  as?: 'p' | 'div' | 'span'       // default: 'p'
  truncate?: boolean              // default: false
}
```

| Вариант | Классы | Где |
|---|---|---|
| `Item variant="default"` | `bg-transparent` | простая строка без рамки |
| `Item variant="outline"` | `rounded-lg border border-border bg-card` | токены, доступы, серверы (дефолт) |
| `Item variant="muted"` | `rounded-lg border border-border bg-muted/30` | read-only `ConfigGroupStep` |
| `size="sm"` | `px-3 py-2 text-sm` | строки списков (дефолт) |
| `size="md"` | `p-3 text-sm` | карточки/детали |
| `size="lg"` | `p-4 text-sm` | крупные строки |
| `interactive` | `transition-colors hover:bg-muted/50` | кликабельная строка (ссылку даёт `ListingRow`) |
| `selected` | `border-primary bg-accent/40` | выбранная строка/пикер |

- `ItemGroup` `gap`: `sm` → `gap-1.5`, `md` → `gap-2` (дефолт), `lg` → `gap-3`.
- `Item` root: `flex min-w-0 flex-wrap items-center gap-3 text-card-foreground`.
- `ItemMedia`: `flex shrink-0 items-center justify-center overflow-hidden rounded-md`; `default` — `bg-muted text-muted-foreground`, `muted` — `bg-muted/50`; `sm` — `size-9`, `md` — `size-10`.
- `ItemContent`: `flex min-w-0 flex-1 flex-col gap-1`.
- `ItemTitle`: `min-w-0 text-sm font-medium leading-snug`; `truncate` добавляет `truncate` (для длинных имён с `title`).
- `ItemDescription`: `min-w-0 break-words text-xs text-muted-foreground`; `truncate` — opt-in.
- `ItemActions`: `flex shrink-0 flex-wrap items-center gap-2`; `align='end'` → `ml-auto justify-end` (дефолт), `align='start'` → `ml-0 justify-start`. На 320 px кнопки переносятся внутри действий, а не распирают строку.
- `Item` — только раскладка, не ссылка. Ссылку/модалку даёт `ListingRow` или `<a>` снаружи; внутри `<a>` интерактив не вкладываем.
- `Item` не строится на `Attachment`: у `Attachment` своя модель файла (`normalizeAttachment`, выбор, прогресс, `data-slot="attachment"`), и он остаётся примитивом файловых строк.
- `ItemGroup as="ul"` + `Item as="li"` — нативный список: `ul` без `role`, `li` без `role`.
- `ItemGroup as="div"` получает `role="list"`; тогда каждый `Item` с `as="div"` или `as="article"` обязан получить `role="listitem"` (компонент ставит его сам). `Item` с `as="li"` вне `<ul>` не используется.
- `Item` — всегда ребёнок `ItemGroup`: вне группы контракт не поддерживается, поэтому авто-`role="listitem"` не создаёт «висячий» listitem.
- `data-slot="item"`, `data-variant`, `data-size`, `data-selected`, `data-interactive`; `ItemActions` — `data-slot="item-actions"`.
- Экспорт: `src/core/ui/item/index.ts` + `export * from './item/index.js'` в `src/core/ui/index.ts`.

```svelte
<ItemGroup as="ul">
  {#each tokens as token (token.id)}
    <Item as="li" variant="outline" size="sm">
      <ItemMedia><KeyIcon /></ItemMedia>
      <ItemContent>
        <ItemTitle truncate title={token.label}>{token.label}</ItemTitle>
        <ItemDescription>Создан {format(token.createdAt)}</ItemDescription>
      </ItemContent>
      <ItemActions>
        <Button {...link('dav-revoke', { tokenId: token.id })} variant="ghost" size="sm">Отозвать</Button>
      </ItemActions>
    </Item>
  {/each}
</ItemGroup>
```

#### 10.2.3. `DescriptionList`

Файлы: `src/core/ui/description-list/DescriptionList.svelte`, `DescriptionListItem.svelte`, `index.ts`. Заменяет 4 копии `dl.grid.grid-cols-[auto_1fr]`.

```ts
type DescriptionListLayout = 'responsive' | 'inline' | 'stacked'
type DescriptionListVariant = 'default' | 'compact'

interface DescriptionListProps extends HTMLAttributes<HTMLDListElement> {
  layout?: DescriptionListLayout   // default: 'responsive'
  variant?: DescriptionListVariant // default: 'default'
}

interface DescriptionListItemProps {
  label: string
  value?: string | number | null
  /** Подсказка/title для значения. */
  title?: string
  truncate?: boolean                // default: false; true — только для коротких значений
  labelClass?: string
  valueClass?: string
  /** Сниппет значения: бейджи, ссылки, несколько строк. */
  children?: Snippet
  'data-testid'?: string
}
```

| Вариант | Классы |
|---|---|
| `layout="responsive"` | `grid grid-cols-1 gap-y-1 sm:grid-cols-[auto_1fr]` |
| `layout="inline"` | `grid grid-cols-[auto_1fr] gap-y-1` |
| `layout="stacked"` | `grid grid-cols-1 gap-y-1` |
| `variant="default"` | `gap-x-3 text-sm` |
| `variant="compact"` | `gap-x-2 gap-y-0.5 text-xs` |

- `DescriptionList` — `<dl class="grid min-w-0 …">`; `data-slot="description-list"`, `data-layout`, `data-variant`.
- `DescriptionListItem` рендерит **пару** `<dt>` + `<dd>` без обёртки: компонент можно ставить только внутри `DescriptionList`.
- `dt`: `text-muted-foreground` + `labelClass`.
- `dd`: `min-w-0 break-words text-foreground`; `truncate` добавляет `truncate`; `title` — на `dd`; `data-testid` — на `dd`.
- `value` по умолчанию `—`; `children` важнее `value`.
- На мобильном по умолчанию одна колонка; `inline` — только когда подписи короткие.
- Экспорт: `src/core/ui/description-list/index.ts` + `export * from './description-list/index.js'` в `src/core/ui/index.ts`.

```svelte
<DescriptionList variant="compact">
  <DescriptionListItem label="Адрес" value="/api/dav/" />
  <DescriptionListItem label="Пароль">пароль приложения из списка ниже</DescriptionListItem>
</DescriptionList>
```

#### 10.2.4. `FormMessage`

Файл: `src/core/ui/form/FormMessage.svelte`. Заменяет 5 ручных `<p class="text-sm text-destructive" role="alert">` в фильтрах и карточках.

```ts
type FormMessageVariant = 'error' | 'muted'

interface FormMessageProps extends Omit<HTMLAttributes<HTMLParagraphElement>, 'children'> {
  message?: string | null
  variant?: FormMessageVariant // default: 'error'
  /** Для aria-describedby у поля. */
  id?: string
  children?: Snippet
}
```

| Вариант | Класс | `role` по умолчанию |
|---|---|---|
| `error` | `text-sm text-destructive` | `alert` |
| `muted` | `text-sm text-muted-foreground` | `status` |

- Если нет `message` и `children` — не рисует ничего.
- `children` заменяет `message` (для форматированного текста).
- Переданный `role` сильнее варианта.
- `class` — для `text-xs`/отступов у конкретного места.
- `data-slot="form-message"`, `data-variant`.
- Форма/общие ошибки остаются на `Common` (`Alert`); `FormMessage` — только inline/range. Ошибки `Field` и `FieldShell` не заменяет.
- В `form/` нет `index.ts`; экспорт добавляется напрямую в `src/core/ui/index.ts`: `export { default as FormMessage } from './form/FormMessage.svelte'`.

```svelte
{#if rangeError}
  <FormMessage message={rangeError} />
{/if}
```

#### 10.2.5. Общие правила API

- Все четыре компонента принимают `class` последним в `cn(...)`; потребитель может переопределить padding/ширину, но не должен менять вариант через строку классов.
- Все варианты — статические ветки `variants()`; никаких `bg-${tone}` и шаблонных классов.
- `data-slot` обязателен у корня каждого компонента: `entry-card`, `item`, `description-list`, `form-message`; тесты ищут по нему, а не по случайным классам.
- `EntryCard` и `Item` принимают HTML-атрибуты через `...rest`; `data-testid` не переопределяется внутри.
- `DescriptionListItem` — только пара `dt`/`dd` без обёртки; `data-testid` и `title` идут на `dd`.
- `FormMessage` не рисует пустой `<p>`; `role` по умолчанию зависит от варианта, явный `role` сильнее.
- Проверки: SSR-рендер каждого варианта, `data-slot`/`data-testid`, отсутствие второго `Card` в `EntryCard`, `ItemGroup as="div"` → `role="list"` и его `Item as="div"`/`article` → `role="listitem"`, `ul`+`li` без role, `DescriptionList` с `grid-cols-1 sm:grid-cols-[auto_1fr]`, `FormMessage` с `role="alert"`.

#### 10.2.6. `Empty` и `Breadcrumb`

- **`Empty`** — уже в §3a; заменяет `Acl`-заглушку, `UserConfig` empty, `StorageServersView` empty, `DriveDavTokens`/`DriveAccess` empty. `EmptyState` из paginator остаётся для ленты.
- **`Breadcrumb`** (опционально, `src/core/ui/breadcrumb/`): `Breadcrumb`, `BreadcrumbList`, `BreadcrumbItem`, `BreadcrumbLink`, `BreadcrumbPage`; нужен только `DriveBrowse`, но это база shadcn и пригодится другим разделам. В первый заход не обязателен.

### 10.3. Что заменить на существующее

- Карточки страниц и форм — на `Surface variant="card"` с `title`/`description`; `max-w-xl`/`max-w-2xl` остаются классами снаружи. В drive добавляем `class="p-4 sm:p-6"`; остальные страницы сохраняют глобальный `p-6`. Новый `PageCard` не нужен.
- 5 карточек-входов (`DriveEntry`, `UserEntries`, `StorageServersEntry`, `SeedUsersEntry`, `HomePage`) — на `EntryCard`; `HomePage`-dev-кнопку — в `footer`.
- Строки ресурсов/конфига — на `ItemGroup` + `Item` + `ItemContent`/`ItemTitle`/`ItemDescription`/`ItemActions`; `DriveDavTokens`/`DriveAccess` — `variant="outline" size="sm"`, read-only `ConfigGroupStep` — `variant="muted"`.
- `dl` в `DriveNodeCard`/`DriveDavTokens` — на `DescriptionList` + `DescriptionListItem` (`layout="responsive"`), до неё — `min-w-0 break-words` по §9a.
- Инлайн-ошибки `DriveFilters`/`SessionsFiltersForm`/`SeedUsersFiltersForm`/`BlocksFiltersForm`/`SessionCard` — на `FormMessage variant="error"`; подсказки без ошибки — `variant="muted"`.
- Кнопки-ссылки в `UserConfig` — на `Button href variant="outline" size="sm"`; это уже есть и даёт focus/disabled/aria.
- Уведомления `DriveBrowse`/`DriveUpload`/`DriveDavTokens` — на `Alert` (`role="status"`/`"alert"`) вместо ручных `<p class="rounded-lg border…">`.
- `DriveNodeCard` row — на `Attachment` + `Item`/`OverflowMenu` (см. §4–§5), без собственной строки.

### 10.4. Границы и риски

- `Item` не должен знать про drive, paginator или формы; только семантические токены и слоты.
- `EntryCard` — единственная новая «карточка с заголовком/описанием/действием»; не плодить `DriveEntryCard`/`UserEntryCard`.
- `DescriptionList` на мобильном переходит в одну колонку — проверить длинные `id`/хеши (`truncate` + `title`). Первые кандидаты: `DriveNodeCard.svelte:71` и `DriveDavTokens.svelte:49`; до компонента — `min-w-0 break-words` (§9a).
- `Acl` переводить на `Empty` последним: у него много состояний и SSR-тестов; сначала `Empty` в `DriveDavTokens`/`DriveAccess`/`StorageServersView`.
- `FormMessage` не заменяет ошибки `Field` — только ручные range/form-ошибки; `Field` остаётся источником ошибок полей.
- `DataRow`/`RowCell` для `BlockCard`/`SeedUserCard` — отдельным решением после `Item`; не тащить в первый заход.

### 10.5. UnoCSS и shadcn-соответствие

- `EntryCard`, `Item`, `DescriptionList`, `FormMessage`, `Empty` используют только `presetWind4` и токены `UNO_THEME`; без `space-*`, `dark:*`, палитровых и динамических классов.
- `Item` повторяет анатомию shadcn `Item` (media/content/title/description/actions), `Empty` — shadcn `Empty`, `FormMessage` — shadcn `FormMessage`.
- `DescriptionList` и `EntryCard` — проектные тонкие обёртки над `Card`/`dl`; визуальный язык не меняют.
- Таблицы вариантов и API из §10.2 — контракт этапа 4: новые варианты/пропы не добавлять без отдельного потребителя; всё новое сначала в `#core/ui`, не в drive.

---

## 10b. Настройки: модульные пункты (реестр + `Surface.rail`)

### 10b.1. Принцип

Первый уровень — **плоский реестр пунктов**, как схема фильтров: схема говорит, что есть и кому видно; UI рисует то, что разрешено. Вложенности в контракте нет: если пункту нужны свои табы, форма или список, он рисует их сам. Второй уровень — «отголосок» компонента, а не часть реестра.

Пункт определяет **модуль**: нет модуля — нет файла регистрации, нет пункта; нет прав — `visible()` вернул `false`; показывать нечего — тоже `false`. Манифест для UI не используется: JSON не умеет проверять права и не знает `uid`.

### 10b.2. Контракт

```ts
export interface SettingsContext {
  readonly uid: string | null      // null — свои настройки, строка — чужой пользователь
  readonly surface: 'page' | 'modal'
  readonly stepsMode: 'url' | 'local' | 'hybrid'
  readonly isOwn: boolean
  readonly canRead: boolean
  readonly canEdit: boolean
}

export interface SettingsSection {
  readonly id: string              // модуль назначает имя сам; оно же ключ адреса
  readonly label: string
  readonly order?: number
  readonly component: Component<{ ctx: SettingsContext }>
  readonly visible?: (ctx: SettingsContext) => boolean
  readonly ownOnly?: boolean       // сахар: только свои настройки
}

registerSettingsSection(section)
settingsSectionsFor(ctx): SettingsSection[]   // filter(ownOnly) → filter(visible) → sort(order)
```

- `id` приходит от модуля (`account`, `drive`, …); центрального перечня нет.
- `uid` — часть контекста, а не отдельный проп: компонент сам решает, что грузить и что скрывать для чужого пользователя.
- `canRead=false` отсекает все пункты — исключение только у базового пункта, который показывает `Acl`.

### 10b.3. Регистрация модулем

```ts
// modules/<name>/files/src/modules/<name>/settings.ext.ts
registerSettingsSection({
  id: 'drive',
  label: 'Диск',
  order: 30,
  component: DriveSettings,
  ownOnly: true,
})
```

Glob в `(site)/+layout.svelte` рядом с `modals.ts`/`config.ext.ts`: `import.meta.glob('/src/modules/**/settings.ext.ts', { eager: true })`. Существующий `registerConfigStep` остаётся для внутренних подшагов пункта «Аккаунт».

### 10b.4. `Surface.rail`

`Surface` сегодня — шапка (`SurfaceBar`) + тело. Добавляем необязательный `rail`:

```ts
rail?: Snippet
railLabel?: string
railWidth?: 'sm' | 'md'   // w-40 | w-56
```

- Один DOM на оба layout: `nav` с `flex overflow-x-auto` на мобильном и `lg:flex-col lg:w-56 lg:border-r lg:pr-4 lg:overflow-visible` на десктопе. Второй экземпляр навигации не рендерится — иначе дублируются ссылки и `id`.
- `aria-label={railLabel}`, активный пункт — `aria-current="page"`.
- Без `rail` разметка и классы `Surface` не меняются — регрессии для остальных экранов нет.
- Пункты rail — обычные ссылки (`Button href`), поэтому работают без JS.

### 10b.5. Хост

`UserConfig` становится `SettingsHost` поверх `Surface`:

- `sections = settingsSectionsFor(ctx)`, `current` из адреса; прямой запрещённый `id` → `Acl`, а не тихий откат к первому;
- значение по умолчанию — первый видимый пункт;
- ноль видимых пунктов → `Acl`/`Empty`, не пустой `Surface`;
- `ctx.uid` берётся у носителя: `/user/config` → `null`, `/user/[id]/config` → id, модалка → проп;
- `rail` — навигация по пунктам; тело — компонент активного пункта с `ctx`.

**Адрес.** Переиспользуем `user_config_step`: значения — `id` пункта, вложенные — `account.security`/`account.sessions` (как сейчас `security.sessions`). Одноразовый alias `profile → account`, `security → account.security` сохраняет старые ссылки; неизвестный `id` — `Acl`, не молчаливый переход.

### 10b.6. «Сессии»

Список сессий — самодостаточный компонент по образцу панели фильтров в `Listing`: рисует свои строки, счётчик и кнопки действий целиком, без специального «примитива сессий» в ядре. Хост передаёт только `ctx` (`uid`, `surface`). Общие элементы берутся из `Listing`/`ListingRow`, кнопки — `Button`, пустота — `Empty`.

### 10b.7. Проверки

- Модуль без файла регистрации → пункта нет; `visible=false` → пункта нет; `ownOnly` + чужой `uid` → пункта нет.
- `id` назначает модуль; два модуля с одним `id` — второй игнорируется.
- `Surface` без `rail` рендерится как раньше; с `rail` — одна `nav`, на мобильном горизонтальная прокрутка без видимого скроллбара.
- Прямой `?user_config_step=<чужой id>` → `Acl`; `profile`/`security` ведут на «Аккаунт» и его подшаг.
- no-JS: rail и подшаги — рабочие GET-ссылки; вложенные табы не требуют JS.
- «Сессии» не тянут отдельный примитив: компонент собирается из `Listing`/`Button`/`Empty`.

---

## 11. Вопросы (перед Build)

1. **Режим OverflowMenu:** начинать с `mode="count"` (просто и предсказуемо) или сразу `mode="fit"` (реально по ширине, но нужен `ResizeObserver` и SSR-фолбэк)? Рекомендую `count` на старте + `fit` как расширение.
2. **`Empty`:** создавать `src/core/ui/empty/` (отдельный примитив) или использовать `EmptyState` из paginator? Рекомендую отдельный — `EmptyState` привязан к пагинатору.
3. **`Attachment` folder:** добавлять `'folder'` + `count`/`badges` в `AttachmentItem` или использовать `kind: 'file'` + `mediaSlot`? Рекомендую первое — drive получает готовый вид без своих примитивов.
4. **Иконки:** хватит ли `ICON_PATHS.folder` внутри `Attachment` или нужен отдельный `FolderIcon` в ядре? Рекомендую первый вариант, пока иконка нужна только Attachment.
5. **Меню «⋯»:** сворачивать только второстепенные (`primary` остаются) или все, кроме первых `maxVisible`? Рекомендую `primary` + `maxVisible`.
6. **No-JS fallback:** `scroll` (одна строка/столбец со скроллом) или `wrap` (перенос)? Рекомендую `scroll` для тулбаров и `wrap` для карточек.
7. **Счётчик на «⋯»:** показывать `moreBadge` (число скрытых) или только иконку? Рекомендую показывать на мобильных, скрывать на десктопе — через `max-sm`/`sm:` классы, без JS.
8. **`count`/`badges` в Attachment:** рендерить бейджи в строке (плюс высота) или только в detail-карточке? Рекомендую в detail, а в row — `description` строкой.

---

## 12. Запреты

- Не менять `tooling/mod.mjs`, сборочные/гард-скрипты, логи сборки, `.modules/installed.json`.
- Не использовать токен `GITHUB_MODALS_KIT` вне сборки.
- Не начинать реализацию до переключения в Build.

```

```
