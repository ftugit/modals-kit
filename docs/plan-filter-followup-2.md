# План: фильтры — follow-up №2

Дата: 2026-11-15. База: незакоммиченные изменения после `docs/plan-filter-followup.md`.

Статус: **пункты 1–9 готовы; браузерные тесты 4.2/5.1 прошли, коммиты не созданы**.

## 1. Ранжированный список

| № | Пункт | Приоритет | Ценность |
|---|---|---|---|
| 1 | Связать `data-filter-block-notice` с контролами через `aria-describedby` | **P1** | Пояснение одиночного `select` становится доступным screen reader, а не только визуальным |
| 2 | Интеграционный тест `commitDraft` с ошибкой | **P1** | Новый путь «валидация → ошибки → не применять» сейчас не покрыт |
| 3 | Регрессия на гонку `draftErrors` | **P1** | Проверить, что ошибки старого popup не появляются после быстрого повторного открытия |
| 4 | Браузерная матрица placeholder/popup/focus | **P1** | happy-dom не проверяет `fieldset[disabled]`, `FormData`, геометрию и автокоммит при закрытии popup |
| 5 | Браузерное снятие группы со связками | **P2** | Проверить оживление подавленных полей, URL и историю на реальном клике |
| 6 | Упростить/задокументировать вычисление group-patch | **P2** | Текущий helper выводит состояние из патчей чипов; нужен явный инвариант или расчёт из `schema` + `extra` |
| 7 | Fallback для пустого `FormError.message` | **P2** | Сводка не должна показывать пустую строку |
| 8 | Убрать или ограничить test-only `catalogFilterPatchRemovesGroup` | **P3** | Меньше публичной поверхности |
| 9 | Гигиена `artifacts/` и логичных коммитов | **P3** | Не смешивать код, тесты и документацию |

## 2. Пункт 1: `aria-describedby` для notice

### 2.1. Решение

- `FilterBlockPopup` даёт notice стабильный `id`.
- После переноса блока в слот popup все `input`, `select`, `textarea` внутри получают этот `id` в `aria-describedby`.
- Существующие `aria-describedby` не затираются: id добавляется к списку.
- При закрытии popup id снимается с контролов; остальные id сохраняются.
- `MutationObserver` нужен потому, что слот popup заполняется после монтирования обёртки.

### 2.2. Проверка

- Компонентный тест: открыть `status` с двумя значениями → у notice есть `id`, у `select` в `aria-describedby` есть этот `id`.
- Проверить, что при отсутствии notice `aria-describedby` не появляется.
- `KIT_ADAPTER=node npm run check`, целевые vitest-тесты, `git diff --check`.

### 2.3. Реализация (2026-11-15)

- `FilterBlockPopup.svelte`: notice получает `id`; `adopt` через `MutationObserver` добавляет этот `id` в `aria-describedby` всех `input/select/textarea` слота и снимает его при закрытии, не затирая чужие id.
- `ActiveFilters.notice.svelte.test.ts`: 7 тестов, включая связь notice и поля и отсутствие `aria-describedby` без notice.
- Проверки: 7 passed, `KIT_ADAPTER=node npm run check` — 0 ошибок/предупреждений, `git diff --check` чисто.

## 2.4. Реализация пункта 2 (2026-11-15)

- `FiltersPanel.test.svelte` и `FiltersPanel.test-harness.svelte`: минимальная форма с обязательным `filters.q`, `PaginatorScope`, fake floating host.
- `FiltersPanel.commit-draft.svelte.test.ts`: 2 теста — недопустимый черновик показывает `[data-testid="active-filters-errors"]` и не меняет `extra`; допустимый черновик записывает `filters.q=great`.
- Проверки: 2 passed, `KIT_ADAPTER=node npm run check` — 0 ошибок/предупреждений, `git diff --check` чисто.

## 3.1. Реализация пункта 3 (2026-11-15)

- `FiltersPanel.commit-draft.svelte.test.ts`: шаги вынесены в `mountPanel`/`openPopup`/`setDraft`/`settleClose`; добавлен тест «закрыть с ошибкой → сразу открыть снова → старые ошибки не появляются».
- Проверки: 3 passed, `KIT_ADAPTER=node npm run check` — 0 ошибок/предупреждений, `git diff --check` чисто.

## 4.1. Проверка браузерной матрицы (2026-11-15)

Проверено в Cloud browser на `/paginator?page.src=animes-rest&page.size=5&page.filters.status=latest`, блок `status` прокручен к нижней границе экрана. Ширины 320/390/430 px, высота 844 px.

| Проверка | 320 | 390 | 430 |
|---|---|---|---|
| placeholder — `FIELDSET` | да | да | да |
| `disabled`, `aria-hidden=true` | да | да | да |
| высота placeholder, px | 64 | 64 | 64 |
| `[name]` / интерактивных потомков в placeholder | 0 / 0 | 0 / 0 | 0 / 0 |
| `[name]` в home-обёртке | 0 | 0 | 0 |
| контролов в popup | 1 | 1 | 1 |
| `FormData` содержит `status=latest` | да | да | да |
| `aria-controls` указывает на существующий узел | да | да | да |
| `aria-label` кнопки × | да | да | да |
| popup целиком в viewport | да | да | да |
| `scrollTop` до/после открытия и закрытия | без изменений | без изменений | без изменений |
| Escape возвращает фокус на метку | да | да | да |

Дополнительно: Tab из поля остаётся внутри `role=dialog`; клик вне закрывает popup; `prefers-reduced-motion: reduce` не мешает открытию; повторное открытие работает.

**Критерий:** кнопки «Применить» внутри popup нет — `FilterActions` остаётся в форме ниже. Поэтому матрица проверяет не доступность кнопки в листе, а автокоммит при закрытии: изменение поля применяется после Escape/клика вне без нажатия «Применить».

### 4.2. Браузерный тест автокоммита (2026-11-15)

- В `test/browser/shikimori.mjs` добавлен `checkFilterPopupCommit`: открыть popup `status`, выбрать «вышел», закрыть Escape без «Применить», проверить URL `status=released`, чип и возврат фокуса на метку.
- Вызов добавлен в `run()` после `checkFiltersUi`.
- Проверено в Cloud browser на `animes-rest`: после выбора «вышел» и Escape URL содержит `page.filters.status=released`, чип показывает «Статус вышел», фокус возвращается на метку `status`.
- `node --check test/browser/shikimori.mjs` проходит.

## 5. Пункт 5: браузерное снятие группы

### 5.1. Реализация (2026-11-15)

- В `test/browser/shikimori.mjs` добавлен `checkFilterGroupRemoval`: URL `status=anons,latest&score.min=5`, клик по × группы, проверка удаления `status`, сохранения `score.min=5`, восстановления поля `score` и неизменной длины `history`.
- Вызов добавлен в `run()` после `checkFilterPopupCommit`.
- Проверено в Cloud browser: после клика по × группы URL больше не содержит `page.filters.status`, `score.min=5` остаётся, поле score показывает 5, длина `history` не меняется (3 → 3).
- Логика патча также покрыта unit-тестами `group-patch.test.ts`.

## 6. Пункт 6: инвариант group-patch

### 6.1. Реализация (2026-11-15)

- В `catalogFilterRemoveGroupPatch` зафиксирован инвариант: правила схемы только подавляют поля, поэтому удаление значений не добавляет подавлений; значения вне группы, выжившие хотя бы в одном патче, выживают после снятия всей группы.
- Добавлен тест на разные значения одной группы, подавляющие разные поля (`group-patch.test.ts`).

## 7. Пункт 7: fallback пустого `FormError.message`

### 7.1. Реализация (2026-11-15)

- `ActiveFilters.svelte`: сводка рисует `error.message || error.code`, а не пустую строку.
- В `ActiveFilters.notice.svelte.test.ts` добавлен тест с ошибкой без `message`: виден `code`.

## 8. Пункт 8: test-only helper

### 8.1. Реализация (2026-11-15)

- Удалён экспортируемый `catalogFilterPatchRemovesGroup`; тесты проверяют инвариант напрямую.
- `docs/plan-filter-followup.md` обновлён, чтобы не ссылаться на удалённый helper.

## 9. Пункт 9: гигиена

### 9.1. Реализация (2026-11-15)

- `/artifacts` добавлен в `.gitignore`: локальные скриншоты и временные проверки не попадают в статус.
- Изменения не смешаны в коммиты; предлагаемая разбивка: `group-patch` (`view.ts` + `group-patch.test.ts`), `notice/a11y` (`FilterBlockPopup` + тесты), `fieldset/commitDraft` (`FilterBlock`, `FiltersPanel` + тесты), `browser tests` (`test/browser/shikimori.mjs`), `docs`.

## 10. Порядок работ

1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9.

Пункты 4–5 требуют браузера; без него они остаются запланированными, а не «проверенными».
