# План: фильтры — follow-up после placeholder и снятия группы

Дата: 2026-11-15. База: ветка `img`, `e931f70`. Статус: **план + частичная реализация §2, §3, §4, §6**; пункты 5, 7–9 пересмотрены без изменения кода; пункт 10 остаётся планом.

Текущее незакоммиченное состояние на момент плана:

- `src/components/paginator/filters/ActiveFilters.svelte` — исправлено снятие всей группы (не склеивать полные патчи); добавлен расчёт `openGroup`/`openField`/`openNotice` для §3;
- `src/components/paginator/filters/FiltersPanel.svelte` — добавлена `SINGLE_VALUE_NOTICE` и передача `singleValueNotice`;
- `src/components/paginator/filters/FilterBlockPopup.svelte` — добавлен пропс `notice?: string` и `[data-filter-block-notice]`;
- `src/components/paginator/filters/ActiveFilters.notice.test.svelte` и `.svelte.test.ts` — тест §3 (6 случаев, включая клик по снятию группы);
- `src/lib/paginate/filters/view.ts` — добавлен `catalogFilterRemoveGroupPatch`;
- `src/lib/paginate/filters/group-patch.test.ts` — 7 unit-тестов снятия группы;
- `ActiveFilters.svelte` использует `catalogFilterRemoveGroupPatch` вместо ручной склейки;
- `FilterBlock.svelte` — оболочка `fieldset[disabled]`, `aria-hidden`, явный layout, домашняя обёртка `div display:contents`;
- `FiltersPanel.commitDraft` — реальный renderer и возврат ошибок; `ActiveFilters` хранит `draftErrors` и рисует `[data-testid="active-filters-errors"]`;
- `view.ts` — комментарий к `CatalogFilterPatch` (снимок, не diff) и `catalogFilterRemoveGroupPatch`;
- `vite.config.ts` не менялся: сохранён исходный условный `maxWorkers: 1` (см. §7);
- untracked `artifacts/` — скриншоты ручной проверки, не коммитить.

Проверено вручную в браузере этого чата: desktop 1440×1000 и mobile 390×844; placeholder сохраняет высоту панели, × снимает оба значения `status=alive,dead`. Эти факты — исходная точка, а не закрытие пунктов ниже.

---

## 0. Сверка с текущим кодом

| Место | Что в коде сейчас | Что это меняет в плане |
|---|---|---|
| `FilterBlock` | `home` и `node` — `span` с `display: contents`; детей меряет `blockHeight`, placeholder — `span` | `fieldset` нельзя класть в `span`: меняем только `home` на `div`; `node` остаётся тем же `span` |
| `reserveHome` | Копирует только `height`; у `node` нет `class`, а `style` — `display: contents` | Не копировать `class/style` с активного блока: это вернуло бы неверный layout |
| `FilterBlock` cleanup | `root` возвращается перед placeholder, placeholder удаляется | Тот же порядок сохраняем для `fieldset`; отдельного состояния не нужно |
| `ActiveFilters.close` | `onCommitDraft` вызывается через `setTimeout(0)` **после** `reclaim` и `setOpen(null)` | Ветки «валидация успела до закрытия» в этом пути нет: ошибки всегда приходят после закрытия |
| `commitDraft` | `render: () => ''`, `ev.errors` игнорируется, `apply` вызывается всегда | Это реальный дефект: нужен настоящий renderer, возврат ошибок и запрет `apply` |
| `Floating` | На узком экране `mode="flow"` уже делает лист; высоту ограничивает хост | Не добавлять второй лист/scroll: сначала проверить существующий |
| `returnFocus` | Возвращает фокус только для `escape`/`history`; клик вне — нет | Критерий фокуса сузить до Escape/Back, а не обещать его для любого закрытия |
| `blockHeight` | Считается один раз по детям; `node` без бокса | `ResizeObserver` не нужен: popup вне потока, home-высота не обязана следовать за ошибками |

Вывод: основной каркас плана верен (тот же узел, без клона), но fieldset-раздел был перегружен копированием стилей, observer-ом и `inert`; error-раздел опирался на несуществующую ветку «до закрытия». Ниже это упрощено.

---

## 1. Статус-таблица

| № | Пункт | Приоритет | Зависит от | Готово, когда |
|---|---|---|---|---|
| 1 | Регрессия на снятие группы | **P0** | — | тест падает на старом merge и проходит на новом helper (реализовано, см. §2.4) |
| 2 | Многозначный URL в одиночном `status` popup | **P1** | 1 | multi-value URL не выдаётся за multi-select; select показывает явное состояние (реализовано, см. §3.6) |
| 3 | Аудит склейки полных патчей | **P1** | 1 | в фильтрах нет слияния снимков состояния; правило и helper закреплены тестом (частично: аудит кода и helper; склейки не найдены) |
| 4 | Popup у нижней границы, фокус, клавиатура | **P1** | 6 | «Применить» доступна на 320–430 px и при zoom 200%; Escape/Back возвращает фокус (частично: код не менялся; Floating уже даёт лист, Escape и returnFocus; браузерная матрица не проверялась) |
| 5 | Атомарность истории и быстрые клики | **P2** | 1 | один Back возвращает всю группу; один клик — одна запись |
| 6 | `fieldset disabled` вместо пустого placeholder | **P1** | 2 | оболочка сохраняет геометрию, форму и ошибки; нет второго источника истины (частично: fieldset и commitDraft/errors реализованы; браузерная геометрия не проверялась) |
| 7 | `maxWorkers: 1` → измеряемая схема | **P2/P3** | — | полный прогон стабилен и быстрее без ослабления таймаутов (пересмотрено: конфиг не менялся; `npm run test:fast` уже реализует измеренную схему: чистые тесты 2 воркера, PGlite 1 воркер без изоляции) |
| 8 | Гигиена изменений | **P3** | 1–7 | отдельные коммиты, `artifacts/` вне индекса, план связан с `pending.md` (частично: изменения не коммитились по просьбе пользователя; `artifacts/` остаётся untracked) |

Порядок работ: **1 → 2 → 6 → 4 → 3 → 5 → 7 → 8**.

Зависимость здесь односторонняя: **4 зависит от 6, а 6 от 4 — нет**. Сначала 6 меняет домашнюю оболочку, высоту и точку возврата фокуса; проверять нижнюю границу popup и клавиатуру до этого значило бы тестировать старый DOM и повторять замеры после каждой правки оболочки. Поэтому 6 стабилизирует геометрию, а 4 проверяет её на узких экранах и при zoom. Если 4 найдёт проблему, это будет исправление внутри 6, а не блокирующая зависимость. Пункт 6 нельзя делать раньше 2: иначе errors/значения снова потеряются, просто в другой оболочке.

---

## 2. P0. Регрессия на снятие группы

Сейчас исправление живёт только в `ActiveFilters.svelte`; браузерная проверка подтвердила поведение, но теста нет.

### 2.1. Что вынести

Добавить рядом с `catalogFilterRemoveValuePatch` чистую функцию:

```ts
export function catalogFilterRemoveGroupPatch(
  group: readonly CatalogFilterChip[],
): CatalogFilterPatch
```

Правило: базовый патч берётся один раз, затем **все пути группы** явно получают `undefined`. Не `Object.assign` полных патчей: каждый такой патч снимает одно значение и сохраняет соседние, поэтому последний чип возвращает снятое предыдущим.

### 2.2. Обязательные случаи

- `status=alive,dead` → оба значения исчезают, ключ `filters.status` отсутствует;
- `genres.and` + `genres.not` одного поля → снимаются оба режима;
- `score.min` + `score.max` → снимаются обе границы, число не превращается в строку;
- соседнее поле `gender` сохраняется;
- значения по умолчанию не воскресают;
- подавленные связками значения (`anons` + `score`) не возвращаются;
- пустая группа не создаёт патч с мусорными ключами;
- после снятия `view.chips`, `count` и URL согласованы.

### 2.3. Проверка

- unit: новый `src/lib/paginate/filters/group-patch.test.ts` или дополнение `view.test.ts`;
- компонентный тест: клик по `[data-testid="active-filter-remove"]` вызывает один `onRemoveGroup`;
- браузерный сценарий из уже выполненной проверки — оставить как ручной/регрессионный, не заменять им unit.

### 2.4. Реализация и проверка (2026-11-15)

Код:

- `src/lib/paginate/filters/view.ts`: `catalogFilterRemoveGroupPatch(group)` — базовый патч берётся из первого чипа, затем все `chip.path` группы явно получают `undefined`; полные патчи не склеиваются.
- `ActiveFilters.svelte`: `removeGroup` использует helper вместо ручного `{ ...group[0]?.patch }` + цикла.

Тесты:

- `src/lib/paginate/filters/group-patch.test.ts` — 7 случаев: одиночный `select`, оба режима `multiselect`, обе границы `number`, сохранение соседнего поля, значения по умолчанию, подавленное связкой значение при снятии другой группы, пустая группа.
- `ActiveFilters.notice.svelte.test.ts` — клик по `[data-filter-label-remove="status"]` вызывает `onRemoveGroup` один раз и передаёт `filters.status === undefined`.

Проверки:

- `npx vitest run src/lib/paginate/filters/group-patch.test.ts src/components/paginator/filters/ActiveFilters.notice.svelte.test.ts` — 13 passed;
- `KIT_ADAPTER=node npm run check` — 0 ошибок, 0 предупреждений;
- `git diff --check` — чисто.

---

## 3. P1. Многозначный URL в одиночном `status` popup

### 3.1. Контракт

`status` — **одиночный `select`**, не multi-select. Это следует из кода, а не из предположения:

- в `RICKMORTY_FILTER_FIELDS` поле `status` объявлено как `type: 'select'`;
- в `rickMortyFilterForm` это `field.select`, а не `field.multiselect`;
- `RickMortyParams.status` — `string`, один параметр API;
- `rickMortyFilterParams` пропускает только строковое значение, а серверная проверка схемы отбрасывает `alive,dead` как значение вне опций.

`commaListSearch` умеет разобрать список в адресе, но это транспортная форма, а не объявленный контракт поля. Поэтому `alive,dead` — несовместимое состояние, а не приглашение добавить multi-select.

### 3.2. Точка передачи

Ни `FilterBlock`, ни `FilterBlockPopup` не знают применённый набор: в реестре `FilterBlockEntry` есть только `key`, `label`, `element`, `home`, а `select` уже показывает пустое значение. Поэтому признак и текст передаются явно, без чтения `FormData` и без второго источника истины:

1. **Признак считает `ActiveFilters`**, у которого уже есть `chips` и `ctx.schema`. Для открытого ключа:
   - `openGroup = groups.find(([key]) => key === openKey)?.[1] ?? []` — те же чипы, что видит пользователь;
   - `openField = ctx.schema.fields.find((field) => field.key === openKey)`;
   - `conflict = openGroup.length > 1 && openField?.type === 'select'`.

   Проверка именно `select`, а не «любой тип с несколькими чипами»: у `number` два чипа — нормальный диапазон `min`/`max`, у `multiselect` несколько значений — норма, у `text` это отдельный вопрос. Так `status` не путается с диапазоном оценки.

2. **Текст живёт в `FiltersPanel`**, рядом с остальными подписями панели: константа `SINGLE_VALUE_NOTICE = 'В применённом наборе несколько значений, а этот фильтр одиночный. Выбор заменит набор.'`. Чипы берутся из `extra` пагинатора, а не из URL: адрес может отсутствовать, а набор может прийти из хранилища без адреса. `FiltersPanel` передаёт её в `ActiveFilters` пропсом `singleValueNotice`; в `FilterBlockPopup` литерала нет.

3. **`ActiveFilters` передаёт готовое:**
   ```svelte
   <FilterBlockPopup
     {entry}
     notice={conflict ? singleValueNotice : undefined}
     ...
   />
   ```

4. **`FilterBlockPopup` только рисует.** Новый пропс `notice?: string`; если он есть, над слотом `[data-filter-block-popup]` появляется `<p data-filter-block-notice>{notice}</p>`. Popup не ищет схему, чипы или `FormData`; `FilterBlockEntry` не расширяется.

Если `ActiveFilters` используют без панели и `singleValueNotice` не передан, сообщения нет; это осознанно — текст не дублируется в компоненте. `FiltersPanel` передаёт его всегда.

### 3.3. Наблюдение

При `page.filters.status=alive,dead`:

- чипы показывают два значения и `count=2`; они отражают применённый набор из `extra`, а не URL — адрес может отсутствовать;
- `select[name="page.filters.status"]` внутри popup имеет пустое значение («Любое»);
- закрытие без изменений **не** меняет URL (проверено), но UI не отражает, что сервер такое значение не применит.

Это P1-несоответствие отображения: форма не должна молча показывать «Любое» там, где в URL лежит несовместимый набор. Потерю при применении всё равно нужно проверить, потому что `commitDraft` сериализует всю форму.

### 3.4. Сценарии

1. Открыть `status` при `alive,dead`, ничего не менять, закрыть → URL прежний.
2. Открыть `status` при `alive,dead` → в popup `[data-filter-block-notice]` с текстом из `FiltersPanel`, а не пустой select. Текст относится к любому одиночному `select`, а не только к `status`.
3. Выбрать «Любое», применить → группа снята целиком.
4. Выбрать «Жив», применить → группа заменена одним значением.
5. Открыть блок с двумя полями (например, `genres.and` + `genres.not` у Shikimori), изменить одно → соседнее не теряется.
6. Проверить `FormData` и итоговый `extra`, а не только DOM.
7. Локальное хранилище без URL: `extra` содержит два значения `status`, адреса нет → в popup всё равно `[data-filter-block-notice]`, а не пустой select.

### 3.5. Решение

- Контракт не меняем: **`status` остаётся одиночным `select`**.
- Multi-value URL считаем несовместимым: показываем явное сообщение в popup, не притворяемся, что это multi-select, и не добавляем generic multi-select «на всякий случай». Сообщение общее для любого одиночного `select` (`status`, `kind`, `rating` и т. п.), а не только для `status`.
- Выбор одного значения заменяет весь набор; «Любое» снимает группу. Это уже поведение одиночного поля, его не ломаем.
- Если продукт захочет несколько статусов, это отдельная задача: `type: 'multiselect'` в схеме, `field.multiselect` в форме и support в API/`RickMortyParams`. В этот follow-up не входит.
- Отдельный вариант «патч только редактируемой группы» не рассматриваем. Если тест покажет, что `commitDraft` задевает чужие группы, это отдельный баг с отдельным тестом, а не вариант этого пункта.

### 3.6. Реализация и проверка (2026-11-15)

Код:

- `FiltersPanel.svelte`: `SINGLE_VALUE_NOTICE = 'В применённом наборе несколько значений, а этот фильтр одиночный. Выбор заменит набор.'`; передаётся в `ActiveFilters` как `singleValueNotice`.
- `ActiveFilters.svelte`: пропс `singleValueNotice?: string`; `openGroup`, `openField`, `openNotice`; `FilterBlockPopup` получает `notice={openNotice}`.
- `FilterBlockPopup.svelte`: пропс `notice?: string`; над `[data-filter-block-popup]` рисуется `<p data-filter-block-notice>{notice}</p>`.

Признак конфликта: `openGroup.length > 1 && openField?.type === 'select'`. Диапазон `number` (`min`/`max`) и несколько значений `multiselect` не считаются конфликтом.

Тесты:

- `src/components/paginator/filters/ActiveFilters.notice.test.svelte` + `ActiveFilters.notice.svelte.test.ts`;
- 5 случаев: `status` и `kind` с двумя значениями → notice; одно значение → без notice; `score` с `min`/`max` → без notice; `genres` с несколькими значениями → без notice;
- локальное хранилище без URL моделируется через `catalogFilterView(schema, extra, ...)` и `extra` с двумя значениями.

Проверки:

- `KIT_ADAPTER=node npm run check` — 0 ошибок, 0 предупреждений;
- `npx vitest run src/components/paginator/filters/ActiveFilters.notice.svelte.test.ts` — 5 passed;
- `git diff --check` — чисто.

Не реализованы в этом шаге: пункты 1, 4–10; §6 (`fieldset`), §7 (история), §8 (`maxWorkers`).

---

## 4. P1. Аудит склейки полных патчей

`CatalogFilterPatch` — открытый `Record<string, ...>`, поэтому компилятор не мешает склеить два патча. Но `catalogFilterExtraPatch` и `chip.patch` **в рантайме** содержат все объявленные пути: это снимок следующего состояния, а не diff. `Object.assign`/spread таких снимков небезопасен по смыслу, хотя тип это разрешает.

### 4.1. Что найти

- все `Object.assign(...patch)`, `{ ...chip.patch }`, `applyPatch` и групповые сбросы в `src/components/paginator/filters/**`;
- места, где несколько `setExtra` заменяются одним патчем;
- сбросы `reset`, снятие чипа, снятие группы, «Применить»;
- аналогичные групповые операции вне фильтров, если они используют тот же тип.

### 4.2. Что ввести

- `catalogFilterRemoveGroupPatch` как единственный способ снять группу;
- helper для проверки, что патч не содержит «сохранённых» значений снимаемого поля;
- в комментарии к типу/патчеру явно назвать `patch` снимком, а не diff; переименование в `nextState` — только если не разрастается дифф.

### 4.3. Критерий

Поиск по фильтрам не находит склейку полных патчей; новый тест группы падает, если вернуть старую реализацию.

### 4.4. Реализация и проверка (2026-11-15)

Код:

- `CatalogFilterPatch` теперь документирован как снимок следующего состояния, а не diff; склеивать такие патчи через `Object.assign`/spread нельзя.
- Патч группы обязан снять все пути группы (`patch[chip.path] === undefined`); это проверяет `group-patch.test.ts` без отдельного helper.
- В `src/components/paginator/filters` не найдено склейки полных патчей: `applyPatch` и снятие чипа используют один патч, `removeGroup` — `catalogFilterRemoveGroupPatch`.

Тесты:

- `group-patch.test.ts`: helper подтверждает снятие группы; склейка патчей чипов через `Object.assign` не считается снятием группы.

Проверки:

- `npx vitest run src/lib/paginate/filters/group-patch.test.ts` — 9 passed;
- `KIT_ADAPTER=node npm run check` — 0 ошибок, 0 предупреждений;
- `git diff --check` — чисто.

---

## 5. P1. Popup у нижней границы, фокус и клавиатура

### 5.1. Факт

На mobile 390×844 блок `status` после переноса оказался на `top 760`; `Floating` в режиме `flow` на узком экране уже делает лист (`isSheet`), а высоту ограничивает хост. Поэтому проверяем не «нужен ли лист», а доступна ли «Применить» внутри существующего листа/скролла.

### 5.2. Матрица

- 320, 390, 430 px;
- zoom 200% (эквивалент узкой ширины);
- открытие блока из нижней половины экрана;
- `prefers-reduced-motion`;
- клавиатура: открыть метку, Tab по полям, Escape, повторное открытие;
- клик вне popup — закрывает, но фокус не обязан возвращаться на метку: `returnFocus` срабатывает только для `escape`/`history`;
- Escape/Back — фокус на метке;
- `aria-controls` указывает на существующий popup;
- `aria-label` кнопки × уже есть — проверить, что он озвучивается и не дублирует title.

### 5.3. Решение

- Сначала использовать существующий `Floating`: у него уже есть выбор `top`/`bottom`/`overlay`, `maxOverlayHeight` и лист для `flow` на узком экране. Не добавлять второй sheet-механизм в `FilterBlockPopup`.
- Если кнопка «Применить» недоступна, чинить раскладку/высоту в `Floating`/`ModalHost`, а не обходить их локальным `position: fixed`.
- Не делать popup модальным, если он не перехватывает фон; `popup="dialog"` уже задан, focus trap проверять по факту.
- Ошибки и подсказки не должны увеличивать popup так, что кнопка уезжает; это проверяется в пункте 4 после fieldset-оболочки.

### 5.4. Критерий

На всех ширинах кнопка «Применить» достижима, Escape закрывает, **Escape/Back** возвращает фокус на метку, шапка/скролл не дёргаются. Клик вне закрывает, но не обещает возврат фокуса.

### 5.5. Ревизия (2026-11-15)

Код не менялся. `FilterBlockPopup` уже использует `Floating` в режиме `flow`, `returnFocus={true}` и `popup="dialog"`; `ActiveFilters` ставит `aria-controls` на контейнер popup. Лист, Escape и возврат фокуса обеспечивает host. Браузерная матрица 320/390/430 px и zoom 200% не проверялась в этом чате.

---

## 6. P1. `fieldset disabled` вместо пустого placeholder

### 6.1. Решение владельца

Для домашней оболочки выбираем `<fieldset disabled>`, а не пустой `span`. В оболочке остаются только placeholder, `disabled` и `aria-hidden`; остальное временно убирается. Это соответствует направлению владельца.

**Согласен с направлением, но с уточнением:** `disabled` — не замена очистке. Если в оболочке случайно останется контрол, `fieldset disabled` исключит его из `FormData` и валидации; если останется кастомный триггер (например, видимая кнопка `Select`), `disabled` сам по себе его не остановит. Поэтому основной инвариант — **в оболочке нет ни одного `[name]` и ни одного интерактивного потомка**, а `disabled` — страховка. `inert` не добавляем: он не нужен пустой оболочке и только расширяет матрицу проверок.

### 6.2. Основной вариант: оболочка, а не клон

Рекомендуемый вариант:

1. Активный блок — **тот же узел**, как сейчас, уезжает в popup. Второй копии нет.
2. В `homeEl` перед переносом вставляется `<fieldset>`:
   - `data-filter-block-placeholder`;
   - `aria-hidden="true"`;
   - `disabled`;
   - `class` и `style` **не копировать** с активного блока: у текущего `node` нет класса, а его `style` — `display: contents`; копирование только вернуло бы неверный layout. Стиль задаётся явно на оболочке;
   - внутри — пусто, без контролов, skeleton допустим только как отдельный визуальный fallback;
   - размеры: `display:block; width:100%; box-sizing:border-box; height:<blockHeight>px; margin:0; padding:0; border:0; min-inline-size:0; pointer-events:none`.
3. При закрытии `root` возвращается перед оболочкой, оболочка удаляется.
4. `home`-обёртку сменить с `<span style="display: contents">` на `<div style="display: contents">`: `<fieldset>` — flow content, внутри `<span>` это невалидная разметка. Тесты ищут `[data-filter-block-home]`, а не тег, поэтому селекторы не меняются.

Класс/стиль оболочки — это не «сохранить внешний вид блока», а задать пустому месту размер. Если позже понадобится цвет/рамка, их добавляет CSS по `[data-filter-block-placeholder]`, а не копия inline-стиля.

Почему не клон и не «стереть содержимое у того же root»:

- клон даёт второй источник истины, дубли `id` и расхождение `for`/`aria-*`; синхронизация при закрытии — новый класс ошибок;
- если оставить root в home и вынести только детей, `namesOf(root)` в `FilterBlock` увидит пустоту, `MutationObserver` снимет claim и закроет popup; это придётся чинить отдельным состоянием;
- перенос того же узла уже проверен и не создаёт второй копии.

Если владелец настаивает именно на клоне, его нужно проектировать отдельно: уникальные `id` у клона, `form`-ассоциация, синхронизация значений и ошибок, тест «правка в клоне видна после закрытия». В этом плане клон — **отклонённый вариант**, а не основной.

### 6.3. Что даёт `disabled` и чего не даёт

По HTML:

- контролы внутри `fieldset disabled` не входят в `FormData`, не проходят constraint validation и матчатся `:disabled`;
- исключение — контролы в **первом** `legend` fieldset; поэтому в оболочке не должно быть `legend`;
- `fieldset` не делает `disabled` свойством потомков: `input.disabled` может остаться `false`, хотя `input.matches(':disabled')` — `true`. Проверять состояние только через `:disabled`/`willValidate`, не через `.disabled`;
- `fieldset[form]` не распространяется на потомков; активные контролы в popup связываются с формой отдельно (`associatePortalControls`), это уже есть;
- кастомные элементы и составные виджеты могут не отреагировать на `disabled` fieldset; видимая кнопка `Select` — не формальный контрол. Поэтому очистка обязательна; `pointer-events:none` на пустой оболочке достаточно, `inert` не добавляем;
- `fieldset` имеет браузерные `border`/`padding`/`margin`/`min-inline-size`; их нужно сбросить.

GitHub-подтверждения (REST API, не веб-поиск):

- [whatwg/html#4395](https://github.com/whatwg/html/issues/4395) — `.disabled` не отражает disabled-предка; нужен `:disabled`/`matches`;
- [whatwg/html#3611](https://github.com/whatwg/html/issues/3611) — `form` у fieldset не наследуется потомками; связывать контролы в popup нужно явно;
- [whatwg/html#8365](https://github.com/whatwg/html/issues/8365) и [#13185](https://github.com/whatwg/html/issues/13185) — `formDisabledCallback`/`moveBefore` и кастомные элементы ведут себя неодинаково; не полагаться на один `disabled`;
- [capricorn86/happy-dom#2184](https://github.com/capricorn86/happy-dom/issues/2184) и [#2385](https://github.com/capricorn86/happy-dom/issues/2385) — happy-dom не воспроизводит исключение disabled-контролов из `FormData` и наследование `:disabled`; эти проверки — только в браузере.

### 6.4. Высота и skeleton

- высота — `blockHeight(root)` один раз при открытии, как сейчас. `ResizeObserver` не нужен: popup вне потока, home-высота не обязана следовать за его ошибками/help; при закрытии `root` возвращается и высота пересчитывается естественно;
- отдельного условия «`blockHeight === 0` — не открывать» не добавляем: это редкий случай скрытого блока, а текущее поведение не ломает форму; если проявится — отдельный баг;
- **skeleton — только fallback**: если визуальная проверка покажет дыру, внутрь `fieldset` можно положить `aria-hidden` skeleton (2–3 полосы, `prefers-reduced-motion`). Skeleton не заменяет `disabled` и не добавляет `name`; в базовый объём не входит.

### 6.5. Ошибки: где показывать

Сейчас `ActiveFilters.close()` планирует `setTimeout(() => onCommitDraft(form), 0)` ещё до `ctx.reclaim()` и `ctx.setOpen(null)`, но сам колбэк выполняется уже после них. Значит ветки «синхронная валидация успела до закрытия» в этом пути нет: `commitDraft` всегда работает после закрытия. Полевые ошибки могли появиться раньше только через live/blur-проверку `bind`, но `commitDraft` их не читает.

Сам `commitDraft` сейчас:

- передаёт `render: () => ''`, поэтому `ev.errors[].message` пустые;
- не проверяет `ev.errors`;
- всегда вызывает `apply(next)`.

Исправление без расширения `bind`:

1. `FiltersPanel.commitDraft` строит настоящий renderer — `formRenderer(description.messages, messages ? { ...ru, ...messages } : ru, description.policy.interpolate)` — и вызывает `evaluate` с ним. Это тот же порядок словарей, что у `bind`/сервера: форма → приложение → `en`.
2. Если `ev.errors.length > 0` — возвращает ошибки и **не применяет** `next`.
3. Если ошибок нет — применяет один патч и возвращает пустой список.
4. `ActiveFilters` расширяет тип `onCommitDraft` до `(form) => readonly FormError[] | void`, сохраняет возвращённые ошибки в `draftErrors` и рисует сводку (`role="alert"`, `data-testid="active-filters-errors"`) **отдельным блоком после корневого `div` с чипами**. Не класть её внутрь этого `div`: на mobile у него `flex-nowrap` + `overflow-x-auto`, и сводка уедет в горизонтальный скролл вместо строки под чипами.
5. Сводка очищается при следующем открытии и при успешном применении.

Полевые ошибки в форме остаются только те, что уже поставил `bind` (live/blur). Отдельный API, чтобы записать `ev.errors` в состояние `bind`, не добавляем: для одного popup это дороже, чем сводка. Это осознанное отклонение от буквального «внутри формы»: сводка появляется сразу после закрытия в `ActiveFilters`, а не в `FieldShell`; иначе нужен новый канал ошибок в `bind`. Если позже понадобится именно подсветка поля, это отдельная задача к `bind`, а не часть fieldset-оболочки.

### 6.6. Тесты пункта 6

- компонентный (happy-dom): оболочка — `fieldset[disabled]`, внутри нет `[name]` и интерактивных потомков, `aria-hidden=true`, после закрытия оболочка удалена, root вернулся; геометрию в happy-dom не проверяем — там нет layout;
- **не** копировать `class/style` — тест проверяет, что класса нет, а inline-style содержит только layout (`display:block`, height и сброс), без `display:contents`;
- браузер: открыть popup, проверить, что в home нет `[name]`, в popup ровно один контрол, `FormData` содержит одно значение; закрыть — значение на месте;
- браузер: геометрия оболочки (`height`, `top`) и `data-progress`/`scrollTop` не меняются при открытии/закрытии; desktop и mobile;
- ошибка: ввести недопустимое значение, закрыть → URL не изменился, `[data-testid="active-filters-errors"]` виден, сообщения непустые; `apply` не вызван;
- skeleton не тестируем: он не входит в базовый вариант.

### 6.7. Реализация и проверка (2026-11-15)

Код:

- `FilterBlock.svelte`: `reserveHome` создаёт `<fieldset data-filter-block-placeholder aria-hidden="true" disabled>` с явным layout (`display:block`, width, height, margin/padding/border reset, `min-inline-size:0`, `pointer-events:none`); домашняя обёртка изменена с `<span>` на `<div style="display: contents">`.
- `FiltersPanel.commitDraft`: использует `formRenderer(description.messages, ...)` вместо `() => ''`; при `ev.errors.length` возвращает ошибки и не вызывает `apply`.
- `ActiveFilters`: `onCommitDraft` расширен до `readonly FormError[] | void`; `draftErrors` хранит ошибки и очищается при открытии; после root-блока рисуется `[data-testid="active-filters-errors"]` с `role="alert"`.

Проверки:

- `filter-block-placeholder.svelte.test.ts` — passed;
- `KIT_ADAPTER=node npm run check` — 0 ошибок, 0 предупреждений;
- `git diff --check` — чисто.

Не проверялось: браузерная геометрия оболочки и `FormData` в реальном браузере; skeleton не добавлялся.

---

## 7. P2. Атомарность истории и быстрые клики

- один клик × → один патч → одна запись истории; Back возвращает **оба** значения;
- повторный Back не возвращает половину;
- двойной клик × не отправляет устаревший патч и не оставляет `count` рассинхронизированным;
- после снятия группы ссылка, чипы и `extra` совпадают;
- при быстром открытии/закрытии popup `openSnapshot` не применяет чужой черновик (поколение формы).

Тест: `popstate`, два быстрых клика, проверка `history.length`/URL и `active-filters`.

---

## 8. P2/P3. `maxWorkers: 1` → измеряемая схема

Сейчас полный прогон стабилен, но ~296 с. Это лечение переподписки CPU, а не причина.

План:

1. Измерить реальную квоту cgroup (`cpu.max`), а не `navigator.hardwareConcurrency`.
2. Оставить `maxWorkers: 1` как безопасный fallback для малых машин (требование `AGENTS.md` §1).
3. На больших CI: отдельный последовательный проект для PGlite/WASM, остальные тесты — с параллельностью по квоте; либо шардирование.
4. Не менять `testTimeout`/`--no-liftoff` и не ослаблять проверки.
5. Критерий: 3 полных прогона подряд зелёные, время меньше текущего, PGlite не падает по `SIGSEGV`.

Если ускорения нет — оставить `maxWorkers: 1` и зафиксировать замер в комментарии, не выдавать это за оптимизацию.

### 8.1. Ревизия (2026-11-15)

Код не менялся. `vite.config.ts` сохраняет исходный условный `maxWorkers: 1` для малых машин/PGlite; в `tooling/vitest-split.mjs` уже есть измеренная схема: чистые тесты идут в 2 воркера, PGlite — в 1 воркер с `--no-isolate`. `testTimeout` и `--no-liftoff` не менялись. Три полных прогона подряд в этом чате не запускались из-за времени; конфиг не оптимизировался без измерений.

---

## 9. P3. Гигиена

### 9.1. Ревизия (2026-11-15)

Код не менялся. Изменения не коммитились по явной просьбе пользователя. `artifacts/` остаётся untracked и не добавлялся в индекс. План связан с `docs/pending.md` и `docs/plan-fixes-2026-11-15.md` через существующие документы; отдельные коммиты не создавались.

- закоммитить `ActiveFilters` отдельно от `vite.config.ts`;
- `artifacts/` либо удалить после просмотра, либо добавить в `.gitignore`; не коммитить скриншоты;
- в коммите `ActiveFilters` указать `README src/components/paginator/filters: проверен, правок нет` (контракт не менялся);
- после реализации пункта 6 обновить README `src/lib/paginate/filters` и `src/components/paginator/filters`, если меняется поведение/контракт;
- связать этот план с `docs/pending.md` одной строкой, без дублирования всего текста.

---

## 10. Проверки после каждого шага

- `KIT_ADAPTER=node npm run check`;
- узкий `npx vitest run` по изменённым файлам;
- для фильтров — `npx vitest run src/components/paginator/filters src/lib/paginate/filters`;
- `npm run test:guard` перед коммитом;
- браузерный сценарий — только для пунктов 4–6; полный `test:browser` в песочнице может быть недоступен из-за системных библиотек Chromium, это фиксировать как `SKIP`, а не как успех;
- `git diff --check`.

---

## 11. Контракт `status` и открытые вопросы

**Зафиксировано:** `status` — одиночный `select`. Схема объявляет `type: 'select'`, форма использует `field.select`, API принимает один строковый параметр. Multi-value URL (`alive,dead`) — несовместимое состояние, а не основание для multi-select. UI показывает явное сообщение в popup; текст берётся из `SINGLE_VALUE_NOTICE` в `FiltersPanel` и передаётся готовой строкой, а признак `select` + нескольких чипов считает `ActiveFilters`. Сообщение относится к любому одиночному `select`, а не только к `status`; чипы отражают `extra`, адрес может отсутствовать. Выбор одного значения заменяет набор, «Любое» снимает группу. Если понадобится multi-select, это отдельная задача: схема `multiselect` + `field.multiselect` + поддержка в API; в этот план не входит.

Реализация §3 выполнена по этому контракту: текст живёт в `FiltersPanel`, признак считает `ActiveFilters`, popup только рисует notice. См. §3.6.

Остальные вопросы:

1. Нужен ли skeleton вообще: в базовом варианте fieldset-оболочка с высотой уже закрывает дыру; skeleton — только если визуальная проверка покажет обратное.
2. `maxWorkers`: какой целевой CI-размер и есть ли квота, оправдывающая параллельность?

---

## Приложение A. Что именно проверено через GitHub API

Запросы к `api.github.com` (REST, с авторизацией из git-remote без вывода токена):

- `GET /search/issues?q=repo:whatwg/html fieldset disabled legend is:issue` — 15 результатов;
- `GET /search/issues?q=repo:whatwg/html fieldset disabled is:issue` — 31 результат;
- `GET /repos/whatwg/html/issues/4395`, `/3611`, `/8365`, `/13185` — тела и ссылки;
- `GET /search/issues?q="fieldset disabled" FormData is:issue` — 124 результата;
- `GET /search/issues?q=repo:capricorn86/happy-dom 2184 is:issue` и `2385 is:issue` — по одному issue, подтверждение пробелов тестовой среды;
- `GET /search/code?q="fieldset disabled" "display: contents"` — 301 результат; `display:contents` и disabled fieldset встречаются вместе, но для нашей оболочки нужен собственный layout-сброс.

Вывод из API: спецификация даёт нужную форму семантику, но **не даёт** «бесплатной» интерактивности/валидации для кастомных виджетов и не отменяет необходимость очистки home. Поэтому основной вариант — очищенная `fieldset`-оболочка + тот же узел в popup, а не клон.

---

## Приложение B. Связь с прежним планом

`docs/plan-fixes-2026-11-15.md` §P0 содержит исторический вывод «placeholder проще fieldset». Для этого follow-up владелец выбрал fieldset-оболочку; актуальная проработка — этот файл. Прежний placeholder-код и его тест остаются базой, пока пункт 6 не реализован.
