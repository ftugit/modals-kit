# Оценка файлов src/ по спецификации SvelteKit (0–10)

Методика, рубрика и критерии K1–K10 — в [README.md](README.md). Статус: `прочитан` — файл прочитан целиком;
`⏳` — ещё не прочитан (оценки нет). Колонка «Предскан» — автоматические признаки, НЕ вердикт.

Прогресс: **59 / 376** файлов прочитано.

Средняя оценка по прочитанным: **8.4**.

## `src/`

| Файл | Строк | Оценка | Статус | Замечания (критерии) | Предскан |
|---|---:|:---:|:---:|---|---|
| `app.d.ts` | 24 | 8 | прочитан | Типы `Locals` объявлены по документации (K3). −1 K9: `db`/`dbCtx` объявлены обязательными, но `hooks.server.ts` заполняет их только для `/db-demo*` и `/api/db-posts*`: на остальных маршрутах тип не соответствует действительности (отсюда защитный `??` в `/api/db-posts`). −1 K9: `App.PageState` не объявлен, хотя проект пишет `page.state` (spike, ядро модалок); отсюда `page.state as any` в SpikeDemo. |  |
| `hooks.server.ts` | 30 | 6 | прочитан | `Handle` из kit, ленивый рантайм БД — верно (K3, K4). −2 K10 (костыль C1): вручную повторяет фильтр путей и ленивое получение БД, хотя `dbHandle` их уже умеет (`paths`, `db: (event)=>Promise<Database>`), и пересоздаёт обработчик на каждый запрос. −1 K9: `inject({event, resolve} as never)` прячет несовпадение типов, хотя `db/sveltekit/context.ts` обещает совместимость с `Handle` без приведения. −1 K10: регистрация транспорта через side-effect импорт `$lib/server/db-list` на весь процесс (обоснование в комментарии есть). | @sveltejs/kit×1 |

## `src/content/`

| Файл | Строк | Оценка | Статус | Замечания (критерии) | Предскан |
|---|---:|:---:|:---:|---|---|
| `items.test.ts` | 52 | 10 | прочитан | Тесты поведения (totals по найденному, регистр, пустая выдача), а не реализации. |  |
| `items.ts` | 104 | 7 | прочитан | Локальный источник демо, честный пагинатор (сужение до пагинации). −1 K4/K10: `demoFault` — глобальный флаг модуля, который включает `PaginatorDemo` и никто не сбрасывает: после визита на `?fault=init` клиентская навигация на `/paginator` без `fault` продолжает падать до перезагрузки. −1 K10: `validateItemsQuery` не используется нигде в `src` (мёртвый экспорт). −1 K5: проверка `typeof window` вместо `BROWSER` из `esm-env`/`browser`. | setTimeout×1 |
| `shikimori-filters.ts` | 117 | 9 | прочитан | Одно объявление полей, из него выводятся ключи адреса и reload-ключи; факты API проверены живьём и записаны. −1 K8: модуль из `src/content` (прикладной код), а импортируют его `$lib/server/*` (см. framework-imports.md, «Смежное»). |  |
| `shikimori.ts` | 169 | 8 | прочитан | Клиентский транспорт только к собственному бэкенду, схема проверяется валидатором. −1 K9: ответ каталога `(await res.json()) as AnimesPage` не проверяется, хотя схему фильтров рядом валидируют. −1 K10: разбор ошибки ответа скопирован дважды (`getAnimesPage`, `getShikimoriFilters`). |  |

## `src/lib/`

| Файл | Строк | Оценка | Статус | Замечания (критерии) | Предскан |
|---|---:|:---:|:---:|---|---|
| `app-errors.svelte.ts` | 75 | 8 | прочитан | Одна точка решения о судьбе ошибки, структурный конверт без импорта типов lib (K8). Модульный `$state` безопасен на сервере: SSR-ветка бросает и не пишет `critical`. −1 K4: эта безопасность держится на порядке веток, а не на устройстве модуля, и в комментарии не названа. −1 K3: `import.meta.env.DEV/SSR` вместо `dev`/`browser` из `$app/environment`. |  |
| `index.ts` | 2 | 10 | прочитан | Заглушка шаблона SvelteKit (пустой `$lib`-индекс); вреда нет. |  |

## `src/lib/components/`

| Файл | Строк | Оценка | Статус | Замечания (критерии) | Предскан |
|---|---:|:---:|:---:|---|---|
| `Error500.svelte` | 23 | 8 | прочитан | Ни строки из ошибки пользователю (K4). −1 K7: `role="alert"` на `<main>` заменяет landmark main. −1 K10: «сырой» `<button>`, хотя во всём приложении используется примитив `Button`. | window/document×1 |

## `src/lib/components/header/`

| Файл | Строк | Оценка | Статус | Замечания (критерии) | Предскан |
|---|---:|:---:|:---:|---|---|
| `LogoSlot.svelte` | 13 | 10 | прочитан | Статичная ссылка-логотип. |  |
| `NavSlot.svelte` | 39 | 7 | прочитан | `aria-current` как единственный признак активности (K7). −2 K8: читает `page.url.pathname` из `$app/state` в обход адаптера (`currentPathname()`), см. framework-imports.md №5. −1 K10: варианты стиля и логика активного пункта продублированы в `SidebarNav`. | $app/×1 |
| `PageTitleSlot.svelte` | 14 | 10 | прочитан | `$derived` от контекста страницы оболочки. |  |
| `SiteFooter.svelte` | 19 | 10 | прочитан | Статичный футер из общего списка навигации. |  |
| `ThemeToggleSlot.svelte` | 56 | 9 | прочитан | Начальная тема ставится скриптом в `app.html` до отрисовки, компонент синхронизируется в `onMount` (K5). −1 K10: атрибут выставляется дважды (`setAttribute` и `dataset`), лишняя проверка `typeof document` в функции, вызываемой только на клиенте. | window/document×5 |
| `index.ts` | 7 | 10 | прочитан | Баррель экспорта. |  |
| `nav.ts` | 16 | 10 | прочитан | Единый список навигации. |  |

## `src/lib/components/sidebar/`

| Файл | Строк | Оценка | Статус | Замечания (критерии) | Предскан |
|---|---:|:---:|:---:|---|---|
| `SidebarFooter.svelte` | 28 | 9 | прочитан | −1 K7: доступное имя кнопок — только значение (`top`, `left`); подпись «Dock:»/«Side:» — соседний `span`, с кнопкой не связана. |  |
| `SidebarNav.svelte` | 40 | 7 | прочитан | −2 K8: `page.url.pathname` из `$app/state` в обход адаптера (framework-imports.md №4). −1 K10: дубль логики `NavSlot`. | $app/×1 |
| `SidebarUser.svelte` | 13 | 10 | прочитан | Статичная разметка (пустой `<script>` безвреден). |  |
| `index.ts` | 4 | 10 | прочитан | Баррель экспорта. |  |

## `src/lib/db/adapters/`

| Файл | Строк | Оценка | Статус | Замечания (критерии) | Предскан |
|---|---:|:---:|:---:|---|---|
| `hyperdrive.ts` | 141 | — | ⏳ |  | setTimeout×1, addEventListener×1 |
| `pg.ts` | 149 | — | ⏳ |  | setTimeout×1, addEventListener×2 |
| `pglite.ts` | 32 | — | ⏳ |  |  |
| `proxy.ts` | 506 | — | ⏳ |  | setTimeout×2, any×1, addEventListener×1 |
| `shared.ts` | 162 | — | ⏳ |  |  |

## `src/lib/db/cursor/`

| Файл | Строк | Оценка | Статус | Замечания (критерии) | Предскан |
|---|---:|:---:|:---:|---|---|
| `codec.ts` | 123 | — | ⏳ |  |  |

## `src/lib/db/`

| Файл | Строк | Оценка | Статус | Замечания (критерии) | Предскан |
|---|---:|:---:|:---:|---|---|
| `database.ts` | 146 | — | ⏳ |  | setTimeout×1, microtask×1 |
| `errors.ts` | 125 | — | ⏳ |  |  |
| `index.ts` | 11 | — | ⏳ |  |  |
| `ops.ts` | 70 | — | ⏳ |  | setTimeout×1 |
| `policy.ts` | 19 | — | ⏳ |  |  |
| `resource.ts` | 522 | — | ⏳ |  |  |
| `schema.ts` | 239 | — | ⏳ |  |  |
| `sqlstate.ts` | 266 | — | ⏳ |  |  |
| `types.ts` | 276 | — | ⏳ |  |  |
| `validation.ts` | 378 | — | ⏳ |  |  |
| `zod.ts` | 10 | — | ⏳ |  |  |

## `src/lib/db/query/`

| Файл | Строк | Оценка | Статус | Замечания (критерии) | Предскан |
|---|---:|:---:|:---:|---|---|
| `sql.ts` | 251 | — | ⏳ |  |  |

## `src/lib/db/sveltekit/`

| Файл | Строк | Оценка | Статус | Замечания (критерии) | Предскан |
|---|---:|:---:|:---:|---|---|
| `context.ts` | 72 | — | ⏳ |  | @sveltejs/kit×1 |
| `cursor.ts` | 38 | — | ⏳ |  |  |
| `errors.ts` | 88 | — | ⏳ |  |  |
| `handle.ts` | 41 | — | ⏳ |  |  |
| `index.ts` | 24 | — | ⏳ |  |  |
| `migrate.ts` | 92 | — | ⏳ |  |  |
| `node.ts` | 260 | — | ⏳ |  |  |
| `query.ts` | 136 | — | ⏳ |  |  |

## `src/lib/db/test/`

| Файл | Строк | Оценка | Статус | Замечания (критерии) | Предскан |
|---|---:|:---:|:---:|---|---|
| `db-docs.test.ts` | 85 | — | ⏳ |  | relative-out-of-lib×1 |
| `db-port-specific.test.ts` | 1062 | — | ⏳ |  | setTimeout×2, microtask×2, any×8, addEventListener×1 |
| `db-ported.test.ts` | 15 | — | ⏳ |  |  |
| `db-structure.test.ts` | 68 | — | ⏳ |  |  |
| `fixture.ts` | 21 | — | ⏳ |  |  |

## `src/lib/db/test/fixtures/`

| Файл | Строк | Оценка | Статус | Замечания (критерии) | Предскан |
|---|---:|:---:|:---:|---|---|
| `probe-rest.ts` | 62 | — | ⏳ |  |  |
| `resources.ts` | 118 | — | ⏳ |  |  |

## `src/lib/db/test/ported/`

| Файл | Строк | Оценка | Статус | Замечания (критерии) | Предскан |
|---|---:|:---:|:---:|---|---|
| `db-followup.script.ts` | 353 | — | ⏳ |  |  |
| `db-hardening.script.ts` | 266 | — | ⏳ |  |  |
| `db-lib.script.ts` | 593 | — | ⏳ |  |  |

## `src/lib/db/testing/`

| Файл | Строк | Оценка | Статус | Замечания (критерии) | Предскан |
|---|---:|:---:|:---:|---|---|
| `index.ts` | 187 | — | ⏳ |  |  |

## `src/lib/filters/`

| Файл | Строк | Оценка | Статус | Замечания (критерии) | Предскан |
|---|---:|:---:|:---:|---|---|
| `catalog-filter.test.ts` | 412 | — | ⏳ |  |  |
| `catalog-filter.ts` | 906 | — | ⏳ |  | any×1 |
| `index.ts` | 12 | — | ⏳ |  |  |
| `rules.test.ts` | 105 | — | ⏳ |  |  |
| `rules.ts` | 163 | — | ⏳ |  |  |
| `view.test.ts` | 397 | — | ⏳ |  |  |
| `view.ts` | 413 | — | ⏳ |  |  |

## `src/lib/form/`

| Файл | Строк | Оценка | Статус | Замечания (критерии) | Предскан |
|---|---:|:---:|:---:|---|---|
| `async.ts` | 191 | — | ⏳ |  | setTimeout×2, any×1 |
| `builtins.ts` | 219 | — | ⏳ |  |  |
| `constraints.ts` | 77 | — | ⏳ |  |  |
| `continuation.ts` | 110 | — | ⏳ |  |  |
| `decode.ts` | 66 | — | ⏳ |  |  |
| `describe.ts` | 371 | — | ⏳ |  | any×2 |
| `devtools.ts` | 102 | — | ⏳ |  |  |
| `editor.ts` | 252 | — | ⏳ |  |  |
| `envelope.ts` | 87 | — | ⏳ |  |  |
| `errors.ts` | 155 | — | ⏳ |  |  |
| `external.ts` | 89 | — | ⏳ |  |  |
| `field-types.ts` | 119 | — | ⏳ |  | any×2 |
| `form.test.ts` | 634 | — | ⏳ |  | any×2 |
| `index.ts` | 37 | — | ⏳ |  |  |
| `keep.ts` | 18 | — | ⏳ |  |  |
| `messages.ts` | 80 | — | ⏳ |  |  |
| `policy.ts` | 130 | — | ⏳ |  |  |
| `queued.ts` | 66 | — | ⏳ |  | setTimeout×1 |
| `registry.ts` | 57 | — | ⏳ |  | any×3 |
| `result.ts` | 118 | — | ⏳ |  |  |
| `schema.ts` | 56 | — | ⏳ |  |  |
| `server.ts` | 474 | — | ⏳ |  | ts-ignore/expect×1 |
| `source.ts` | 129 | — | ⏳ |  |  |
| `spec.ts` | 168 | — | ⏳ |  |  |
| `state.ts` | 110 | — | ⏳ |  |  |
| `strength.ts` | 143 | — | ⏳ |  |  |
| `submit.ts` | 255 | — | ⏳ |  |  |
| `types.ts` | 75 | — | ⏳ |  |  |
| `upload.ts` | 30 | — | ⏳ |  |  |
| `url.test.ts` | 61 | — | ⏳ |  |  |
| `url.ts` | 88 | — | ⏳ |  |  |
| `validate.ts` | 107 | — | ⏳ |  |  |
| `validators.ts` | 371 | — | ⏳ |  | any×25 |

## `src/lib/form/react/`

| Файл | Строк | Оценка | Статус | Замечания (критерии) | Предскан |
|---|---:|:---:|:---:|---|---|
| `bind.ts` | 580 | — | ⏳ |  | window/document×2, addEventListener×1 |
| `config.ts` | 91 | — | ⏳ |  |  |
| `index.ts` | 4 | — | ⏳ |  |  |

## `src/lib/form/solid/`

| Файл | Строк | Оценка | Статус | Замечания (критерии) | Предскан |
|---|---:|:---:|:---:|---|---|
| `bind.ts` | 544 | — | ⏳ |  | window/document×2, microtask×1, addEventListener×1 |
| `config.ts` | 89 | — | ⏳ |  |  |
| `index.ts` | 4 | — | ⏳ |  |  |

## `src/lib/form/svelte/`

| Файл | Строк | Оценка | Статус | Замечания (критерии) | Предскан |
|---|---:|:---:|:---:|---|---|
| `Form.svelte` | 49 | — | ⏳ |  |  |
| `bind.svelte.ts` | 602 | — | ⏳ |  | $effect×1, window/document×2, addEventListener×1 |
| `config.ts` | 120 | — | ⏳ |  |  |
| `index.ts` | 6 | — | ⏳ |  |  |

## `src/lib/links/`

| Файл | Строк | Оценка | Статус | Замечания (критерии) | Предскан |
|---|---:|:---:|:---:|---|---|
| `catalog.test.ts` | 150 | 10 | прочитан | Табличный тест паритета двух движков на одних данных: правильный способ удержать дубль до его удаления. |  |
| `catalog.ts` | 128 | 7 | прочитан | Перевод схемы на язык ядра, паритет с движком схемы под тестом. −2 K10: в рантайме не используется. Живой код (`PaginatorSettingsForm`, `catalog-filter`) работает через `lib/filters/rules.ts` и прямые вызовы ядра; «будущий единственный движок (этап 5)» пока второй движок, который держится только тестом паритета. −1 K10: комментарий `catalogLinkSet` описывает будущее («после этапа 5 он зовёт именно эту функцию»). |  |
| `index.ts` | 5 | 9 | прочитан | Баррель ядра. −1 K10: комментарий ссылается на несуществующий `$lib/links/panel`. |  |
| `links.test.ts` | 182 | 10 | прочитан | Контракт ядра на поведении, включая крайние случаи (повторы, кардинальность, пустые значения). |  |
| `links.ts` | 140 | 8 | прочитан | Чистое нейтральное ядро без фреймворка и домена (K8), одна функция — одна ответственность. −2 K10: в шапке модуля посреди русского текста мусор после правки: «Домен здесь只有一个 факт» (китайские иероглифы). |  |
| `validators.ts` | 74 | 9 | прочитан | Нейтральная фабрика валидатора, кардинальность согласована с ядром и view (покрыто тестом). −1 K8: файл «нейтрального ядра» зависит от `$lib/form/validators` (связь links → form). Допустимо, так как файл не экспортируется из `index.ts`, но в комментарии модуля это не названо. |  |

## `src/lib/links/svelte/`

| Файл | Строк | Оценка | Статус | Замечания (критерии) | Предскан |
|---|---:|:---:|:---:|---|---|
| `effects.svelte.ts` | 42 | 8 | прочитан | Образцовый адаптер: только `$derived` над геттерами потребителя, без записи (K2). −2 K10: не используется нигде: `PaginatorSettingsForm.svelte` вызывает `computeLinks`/`linkHelperText` напрямую, в обход этого Svelte-входа. |  |
| `index.ts` | 4 | 9 | прочитан | Svelte-вход модуля. −1 K10: экспортирует только неиспользуемый `useLinkEffects`. |  |

## `src/lib/modals/`

| Файл | Строк | Оценка | Статус | Замечания (критерии) | Предскан |
|---|---:|:---:|:---:|---|---|
| `acceptance.test.ts` | 328 | — | ⏳ |  | any×11 |
| `build.test.ts` | 582 | — | ⏳ |  | window/document×1, any×15 |
| `build.ts` | 441 | — | ⏳ |  |  |
| `core-contract.ts` | 168 | — | ⏳ |  | window/document×1 |
| `core.ts` | 610 | — | ⏳ |  | any×1 |
| `create.ts` | 552 | — | ⏳ |  |  |
| `engine.ts` | 69 | — | ⏳ |  |  |
| `geometry.test.ts` | 97 | — | ⏳ |  |  |
| `index.ts` | 42 | — | ⏳ |  |  |
| `loader.test.ts` | 246 | — | ⏳ |  | setTimeout×1, any×20, addEventListener×1 |
| `loader.ts` | 232 | — | ⏳ |  |  |
| `matrix.test.ts` | 273 | — | ⏳ |  | any×1 |
| `registry.test.ts` | 120 | — | ⏳ |  | any×1 |
| `registry.ts` | 193 | — | ⏳ |  |  |
| `scoped-config.test.ts` | 41 | — | ⏳ |  |  |
| `sources.test.ts` | 199 | — | ⏳ |  | any×2 |
| `storages.test.ts` | 211 | — | ⏳ |  | any×2 |
| `storages.ts` | 154 | — | ⏳ |  | window/document×1 |
| `store.ts` | 145 | — | ⏳ |  |  |
| `types.ts` | 356 | — | ⏳ |  |  |

## `src/lib/modals/cores/`

| Файл | Строк | Оценка | Статус | Замечания (критерии) | Предскан |
|---|---:|:---:|:---:|---|---|
| `fastedge.test.ts` | 221 | — | ⏳ |  | window/document×2, sveltekit-internal×1, any×3 |
| `fastedge.ts` | 88 | — | ⏳ |  | window/document×2 |
| `memory.ts` | 18 | — | ⏳ |  |  |
| `routes.test.ts` | 48 | — | ⏳ |  |  |
| `routes.ts` | 48 | — | ⏳ |  |  |
| `sveltekit.ts` | 169 | — | ⏳ |  | $app/×4, window/document×13, history.*State×1, sveltekit-internal×3, microtask×2, addEventListener×1 |

## `src/lib/modals/svelte/`

| Файл | Строк | Оценка | Статус | Замечания (критерии) | Предскан |
|---|---:|:---:|:---:|---|---|
| `Layers.svelte` | 39 | — | ⏳ |  |  |
| `ModalContent.svelte` | 91 | — | ⏳ |  | $effect×1, any×4, untrack×1 |
| `ModalHost.svelte` | 1163 | — | ⏳ |  | $effect×9, window/document×16, setTimeout×3, rAF×3, microtask×1, any×4, untrack×6, addEventListener×4 |
| `ModalTrigger.svelte` | 202 | — | ⏳ |  | $effect×2 |
| `Tails.svelte` | 84 | — | ⏳ |  | $effect×1, rAF×1 |
| `classes.ts` | 171 | — | ⏳ |  |  |
| `context.ts` | 221 | — | ⏳ |  | window/document×2 |
| `index.ts` | 28 | — | ⏳ |  |  |
| `media.svelte.ts` | 42 | — | ⏳ |  | $effect×1, $app/×1, window/document×1, addEventListener×1 |
| `state.svelte.ts` | 246 | — | ⏳ |  |  |
| `store.svelte.ts` | 62 | — | ⏳ |  |  |

## `src/lib/paginate/`

| Файл | Строк | Оценка | Статус | Замечания (критерии) | Предскан |
|---|---:|:---:|:---:|---|---|
| `adapter-cursor.ts` | 202 | — | ⏳ |  |  |
| `adapter-local.ts` | 42 | — | ⏳ |  |  |
| `adapter-url.ts` | 682 | — | ⏳ |  | window/document×6, microtask×1 |
| `anchors.ts` | 245 | — | ⏳ |  |  |
| `core.ts` | 728 | — | ⏳ |  |  |
| `events.ts` | 24 | — | ⏳ |  |  |
| `index.ts` | 17 | — | ⏳ |  |  |
| `layout.ts` | 155 | — | ⏳ |  |  |
| `paginate.test.ts` | 1118 | — | ⏳ |  | any×1 |
| `pure.ts` | 113 | — | ⏳ |  |  |
| `registry.ts` | 96 | — | ⏳ |  |  |
| `source.test.ts` | 341 | — | ⏳ |  |  |
| `source.ts` | 408 | — | ⏳ |  |  |
| `storage.ts` | 115 | — | ⏳ |  |  |
| `store.ts` | 121 | — | ⏳ |  |  |
| `types.ts` | 234 | — | ⏳ |  |  |

## `src/lib/paginate/solid/`

| Файл | Строк | Оценка | Статус | Замечания (критерии) | Предскан |
|---|---:|:---:|:---:|---|---|
| `index.ts` | 2 | — | ⏳ |  |  |

## `src/lib/paginate/svelte/`

| Файл | Строк | Оценка | Статус | Замечания (критерии) | Предскан |
|---|---:|:---:|:---:|---|---|
| `EdgeSentinel.svelte` | 46 | — | ⏳ |  | $effect×1, untrack×1 |
| `LoadMoreSlot.svelte` | 93 | — | ⏳ |  | untrack×1 |
| `PageAnchor.svelte` | 53 | — | ⏳ |  | $effect×1, untrack×1 |
| `PaginatorHost.svelte` | 662 | — | ⏳ |  | $effect×8, window/document×1, rAF×3, any×8, svelte-ignore×1, untrack×2 |
| `PaginatorScope.svelte` | 33 | — | ⏳ |  | untrack×1 |
| `PendingIndicator.svelte` | 42 | — | ⏳ |  | untrack×1 |
| `context.svelte.ts` | 243 | — | ⏳ |  | $effect×2 |
| `index.ts` | 30 | — | ⏳ |  |  |

## `src/lib/router/`

| Файл | Строк | Оценка | Статус | Замечания (критерии) | Предскан |
|---|---:|:---:|:---:|---|---|
| `LoadLink.svelte` | 99 | 6 | прочитан | Ссылка работает без JS, состояние «битая» есть уже в SSR (K6), runes (K1). −2 K3 (костыль C4, по типам kit 2.70.3): `preloadData` возвращает `{type:'loaded', status}`, в том числе при ошибке загрузчика (status ≥ 400), и `{type:'redirect'}`. Код считает ошибкой только redirect, а ошибочный `loaded` — успехом; ветка «не удалось загрузить страницу» для настоящей ошибки недостижима. −1 K10: нет `try/catch` вокруг `await preloadData`: при отказе сети промис отклоняется, `status` навсегда остаётся `'loading'`, ссылка блокируется. −1 K8: импортирует `routeResolves` из ядра модалок: роутерный слой зависит от модуля модалок. | $effect×1, $app/×1 |
| `sveltekit.ts` | 122 | 8 | прочитан | Адаптер: единственная точка `$app/state`/`$app/navigation` для пагинатора (K8). `createSubscriber` — штатный способ подключить внешний источник (K2). Причина отступления подробно задокументирована. −1 K3: адрес хранится в URL через shallow `replaceState` и читается из `window.location`, хотя документация shallow routing рассчитана на `page.state`; отступление осознанное (альтернативы отклонены в S3). −1 K10: зависимость `void page.url` как сигнал навигации — неявный приём, держится только на комментарии. Замечание на будущее: `$app/environment` устарел в SvelteKit 3 (`$app/env`). | $app/×3, window/document×8, history.*State×2, addEventListener×1 |

## `src/lib/search/`

| Файл | Строк | Оценка | Статус | Замечания (критерии) | Предскан |
|---|---:|:---:|:---:|---|---|
| `accumulator.ts` | 504 | — | ⏳ |  |  |
| `core.ts` | 58 | — | ⏳ |  |  |
| `dictionary.ts` | 97 | — | ⏳ |  |  |
| `fuzzy.ts` | 382 | — | ⏳ |  |  |
| `index.ts` | 59 | — | ⏳ |  |  |
| `registry.ts` | 136 | — | ⏳ |  |  |
| `search.test.ts` | 445 | — | ⏳ |  | setTimeout×1 |
| `stats.test.ts` | 117 | — | ⏳ |  |  |
| `stats.ts` | 47 | — | ⏳ |  |  |
| `types.ts` | 62 | — | ⏳ |  |  |

## `src/lib/search/svelte/`

| Файл | Строк | Оценка | Статус | Замечания (критерии) | Предскан |
|---|---:|:---:|:---:|---|---|
| `correction.svelte.ts` | 41 | — | ⏳ |  | $effect×1 |
| `index.ts` | 5 | — | ⏳ |  |  |
| `stats.svelte.ts` | 36 | — | ⏳ |  | $effect×1, untrack×1 |

## `src/lib/server/`

| Файл | Строк | Оценка | Статус | Замечания (критерии) | Предскан |
|---|---:|:---:|:---:|---|---|
| `db-list.ts` | 148 | — | ⏳ |  |  |
| `db.ts` | 152 | — | ⏳ |  |  |
| `form-security.ts` | 82 | — | ⏳ |  |  |
| `graphql.test.ts` | 173 | — | ⏳ |  | setTimeout×2 |
| `graphql.ts` | 205 | — | ⏳ |  | setTimeout×1, addEventListener×1 |
| `live-cache.test.ts` | 68 | — | ⏳ |  |  |
| `live-cache.ts` | 76 | — | ⏳ |  |  |
| `shikimori-filters.test.ts` | 297 | — | ⏳ |  |  |
| `shikimori-filters.ts` | 274 | — | ⏳ |  | relative-out-of-lib×1 |
| `shikimori-schema.test.ts` | 227 | — | ⏳ |  |  |
| `shikimori-schema.ts` | 327 | — | ⏳ |  | relative-out-of-lib×1 |
| `shikimori.test.ts` | 398 | — | ⏳ |  |  |
| `shikimori.ts` | 506 | — | ⏳ |  | relative-out-of-lib×1, setTimeout×1, addEventListener×1 |

## `src/lib/shell/`

| Файл | Строк | Оценка | Статус | Замечания (критерии) | Предскан |
|---|---:|:---:|:---:|---|---|
| `AppShell.svelte` | 196 | 7 | прочитан | Drawer без JS на checkbox и `:has()`, ref-ы через `bind:this` (K6). `svelte-ignore` для label-кнопок обоснован (лейбл управляет checkbox). −1 K2: `isNarrow` вручную через `matchMedia` в `onMount`, хотя есть `MediaQuery` из `svelte/reactivity`. −1 K7: «кнопки» — `<label role="button" tabindex="0">` с ручной обработкой Enter/Space (`labelKeyHandler`) вместо `<button>`: компромисс ради работы без JS, но вручную воспроизводит поведение кнопки. −1 K10: тянет `BACKDROP_UTILS` из `$lib/modals/svelte/classes`, то есть оболочка зависит от модуля модалок. | window/document×1, svelte-ignore×3, addEventListener×1 |
| `CollapsingHeader.svelte` | 321 | 6 | прочитан | Императивная анимация по скроллу вне реактивности — оправдана частотой событий. −1 K10 (костыль C5): «на всякий случай» перемер по таймерам `setTimeout(measure, 300)` и `1200` поверх `ResizeObserver`. −1 K2 (костыль C5): эффект строк 121–136 читает `const _rows = rows` только ради зависимости; при этом вложенные изменения слотов (`header[row][side] = …`) ссылку `rows` не меняют, так что «перемер при смене rows», обещанный комментарием, не происходит. −1 K10: `ResizeObserver` подписывается на `inner.top/bottom` один раз в `onMount`: ряд, появившийся позже, не наблюдается. −1 K10: разметка рядов top и bottom продублирована. | $effect×2, window/document×13, setTimeout×3, rAF×2, addEventListener×2 |
| `HeaderRowView.svelte` | 56 | 9 | прочитан | Чистое представление ряда. −1 K10: проверки `slots.start &&` при типе, где массивы обязательны. |  |
| `HeaderSlot.svelte` | 39 | 8 | прочитан | Регистрация в `$effect` с очисткой — внешний эффект, по назначению (K2). −1 K5: регистрация в эффекте, поэтому в SSR слот не попадает, в отличие от `useHeaderSlot` («SSR-safe»); разница не задокументирована. −1 K10: условие строки 32 повторяет `isSidebar`. | $effect×1 |
| `PageHead.svelte` | 49 | 6 | прочитан | Мета-теги из контекста страницы, `$derived` заголовка. −3 K5/K3 (баг F7, подтверждён пробой `title_probe.py`): на страницах внутри AppShell SSR отдаёт `<title>dd modals</title>`, а после гидрации — заголовок страницы из её `<svelte:head>`. Два источника `<title>` (этот компонент и страницы) конкурируют; без JS и для краулеров заголовок неверен. −1 K10: `useHeadSeo` в проекте не вызывается, поэтому SEO-поля, кроме title, мертвы, а маршруты ставят `<title>` в обход механизма. |  |
| `index.ts` | 38 | 10 | прочитан | Публичный API модуля оболочки (баррель). |  |
| `page.svelte.ts` | 226 | 7 | прочитан | Контекст страницы через `setContext`/`getContext` (по документации state-management: состояние в контексте, а не в модуле — K4). Регистрация слотов синхронна, поэтому работает и в SSR. −1 K2: `enabled: () => boolean` и `useHeadSeo(() => …)` вычисляются один раз при вызове: сигнатура обещает реактивность, которой нет. −1 K10: `registerHeaderSlot` и `registerSidebarSlot` — копии одной логики вставки по `offset`. −1 K10: мёртвый псевдоним типа `HeaderRows = HeaderSlots`. | $effect×3 |
| `shell.svelte.ts` | 83 | 7 | прочитан | Состояние оболочки в контексте (K4), валидация прочитанного из хранилища. −2 K5: `localStorage` читается в конструкторе: SSR рисует `top/left`, клиент сразу ставит сохранённое (пробой `shell_hydration_probe.py`: после гидрации `dock=bottom`, без предупреждений), то есть у пользователя с нестандартной раскладкой шапка и панель перескакивают после загрузки. Устраняется cookie и чтением в `load` или скриптом в `app.html`, как у темы. −1 K10: неиспользуемый импорт `onMount`. | window/document×2 |
| `use-drawer.svelte.ts` | 86 | 4 | прочитан | Drawer поверх checkbox работает без JS (K6). −4 K3 (баг F6, подтверждён пробой `drawer_probe.py`): открытие вызывает нативный `history.pushState` и копирует служебные ключи `sveltekit:history`/`sveltekit:navigation` в новую запись. SvelteKit в dev предупреждает: «Avoid using history.pushState(...)… Use the pushState and replaceState imports from $app/navigation». Документированный путь для «Назад закрывает панель» — [shallow routing](https://svelte.dev/docs/kit/shallow-routing) (`pushState` + `page.state`) через адаптер. Предупреждение пропущено при обходе во 2-м ходе (обход был на широком экране). −1 K10: `panel` в `DrawerOptions` принимается, но не используется. −1 K10: проверки `typeof history` внутри `onMount`/обработчиков лишние. | window/document×10, history.*State×1, addEventListener×3 |

## `src/lib/ui/`

| Файл | Строк | Оценка | Статус | Замечания (критерии) | Предскан |
|---|---:|:---:|:---:|---|---|
| `cn.ts` | 45 | — | ⏳ |  |  |
| `index.ts` | 2 | — | ⏳ |  |  |
| `js-only.svelte.ts` | 24 | — | ⏳ |  |  |

## `src/lib/ui/demo/cycle/`

| Файл | Строк | Оценка | Статус | Замечания (критерии) | Предскан |
|---|---:|:---:|:---:|---|---|
| `CycleDemo.svelte` | 203 | — | ⏳ |  | window/document×2, any×2, addEventListener×1 |

## `src/lib/ui/demo/db-form/`

| Файл | Строк | Оценка | Статус | Замечания (критерии) | Предскан |
|---|---:|:---:|:---:|---|---|
| `CreateForm.svelte` | 124 | — | ⏳ |  | $effect×2, window/document×1, untrack×1 |
| `RemoveForm.svelte` | 60 | — | ⏳ |  | $effect×1, untrack×1 |
| `description.ts` | 43 | — | ⏳ |  |  |
| `handle.ts` | 149 | — | ⏳ |  |  |

## `src/lib/ui/demo/db-list/`

| Файл | Строк | Оценка | Статус | Замечания (критерии) | Предскан |
|---|---:|:---:|:---:|---|---|
| `DbPostPendingRow.svelte` | 47 | — | ⏳ |  |  |
| `DbPostRow.svelte` | 66 | — | ⏳ |  |  |
| `DbPostsList.svelte` | 294 | — | ⏳ |  | $effect×2, window/document×1 |
| `ListMeta.svelte` | 50 | — | ⏳ |  |  |
| `cursor-mode.svelte.ts` | 52 | — | ⏳ |  | $effect×1 |
| `definition.test.ts` | 99 | — | ⏳ |  |  |
| `definition.ts` | 340 | — | ⏳ |  |  |
| `live.svelte.ts` | 184 | — | ⏳ |  | window/document×4, setTimeout×5, addEventListener×1 |
| `live.test.ts` | 180 | — | ⏳ |  |  |
| `optimistic.svelte.ts` | 144 | — | ⏳ |  |  |
| `optimistic.test.ts` | 119 | — | ⏳ |  |  |

## `src/lib/ui/demo/form/`

| Файл | Строк | Оценка | Статус | Замечания (критерии) | Предскан |
|---|---:|:---:|:---:|---|---|
| `extend.ts` | 114 | — | ⏳ |  | setTimeout×1 |
| `forms.config.ts` | 65 | — | ⏳ |  |  |
| `handle.ts` | 109 | — | ⏳ |  |  |
| `index.ts` | 6 | — | ⏳ |  |  |
| `psp.ts` | 69 | — | ⏳ |  |  |
| `signup.ts` | 97 | — | ⏳ |  |  |
| `transport.ts` | 77 | — | ⏳ |  |  |

## `src/lib/ui/demo/form/ui/`

| Файл | Строк | Оценка | Статус | Замечания (критерии) | Предскан |
|---|---:|:---:|:---:|---|---|
| `CheckboxField.svelte` | 22 | — | ⏳ |  |  |
| `Common.svelte` | 19 | — | ⏳ |  |  |
| `Field.svelte` | 11 | — | ⏳ |  |  |
| `FieldShell.svelte` | 36 | — | ⏳ |  |  |
| `PasswordField.svelte` | 45 | — | ⏳ |  |  |
| `RatingField.svelte` | 23 | — | ⏳ |  |  |
| `SelectField.svelte` | 27 | — | ⏳ |  |  |
| `TextField.svelte` | 18 | — | ⏳ |  |  |
| `TextareaField.svelte` | 25 | — | ⏳ |  |  |

## `src/lib/ui/demo/modals/`

| Файл | Строк | Оценка | Статус | Замечания (критерии) | Предскан |
|---|---:|:---:|:---:|---|---|
| `CardModal.svelte` | 248 | — | ⏳ |  |  |
| `FloatingMenu.svelte` | 252 | — | ⏳ |  | $effect×2, window/document×4, svelte-ignore×1, addEventListener×2 |
| `FlowProbeModal.svelte` | 109 | — | ⏳ |  |  |
| `FullpageModal.svelte` | 49 | — | ⏳ |  |  |
| `LockedModal.svelte` | 14 | — | ⏳ |  |  |
| `SelectModal.svelte` | 72 | — | ⏳ |  |  |
| `SettingsPanel.svelte` | 210 | — | ⏳ |  | $effect×2, untrack×2 |
| `SourcesPanel.svelte` | 136 | — | ⏳ |  | $effect×1, window/document×7, setTimeout×2, untrack×1, addEventListener×2 |
| `index.ts` | 10 | — | ⏳ |  |  |
| `registry.ts` | 70 | — | ⏳ |  | setTimeout×1, any×1 |
| `sources.svelte.ts` | 16 | — | ⏳ |  |  |

## `src/lib/ui/demo/paginator/`

| Файл | Строк | Оценка | Статус | Замечания (критерии) | Предскан |
|---|---:|:---:|:---:|---|---|
| `AnimeRow.svelte` | 43 | — | ⏳ |  | relative-out-of-lib×1 |
| `AnimeTile.svelte` | 28 | — | ⏳ |  | relative-out-of-lib×1 |
| `DemoPaginator.svelte` | 568 | — | ⏳ |  | $effect×1, $app/×1, untrack×2 |
| `FiltersPanel.svelte` | 136 | — | ⏳ |  | $app/×1 |
| `GalleryDemo.svelte` | 129 | — | ⏳ |  | relative-out-of-lib×1 |
| `ItemRow.svelte` | 21 | — | ⏳ |  |  |
| `PaginatorDemo.svelte` | 115 | — | ⏳ |  | relative-out-of-lib×1, window/document×2 |
| `SearchQueryForm.svelte` | 195 | — | ⏳ |  | setTimeout×1, svelte-ignore×3 |
| `ShotTile.svelte` | 36 | — | ⏳ |  | relative-out-of-lib×1 |
| `definition.test.ts` | 51 | — | ⏳ |  |  |
| `definition.ts` | 616 | — | ⏳ |  | relative-out-of-lib×3 |
| `item-views.ts` | 77 | — | ⏳ |  | relative-out-of-lib×2 |
| `loader.ts` | 110 | — | ⏳ |  | relative-out-of-lib×1 |
| `types.ts` | 23 | — | ⏳ |  | relative-out-of-lib×1 |

## `src/lib/ui/demo/spike/`

| Файл | Строк | Оценка | Статус | Замечания (критерии) | Предскан |
|---|---:|:---:|:---:|---|---|
| `SpikeDemo.svelte` | 215 | — | ⏳ |  | $app/×2, window/document×31, sveltekit-internal×1, any×7, addEventListener×1 |

## `src/lib/ui/filters/`

| Файл | Строк | Оценка | Статус | Замечания (критерии) | Предскан |
|---|---:|:---:|:---:|---|---|
| `ActiveFilters.svelte` | 79 | — | ⏳ |  |  |
| `CatalogFilterForm.svelte` | 230 | — | ⏳ |  | svelte-ignore×3 |
| `index.ts` | 3 | — | ⏳ |  |  |

## `src/lib/ui/modals/`

| Файл | Строк | Оценка | Статус | Замечания (критерии) | Предскан |
|---|---:|:---:|:---:|---|---|
| `BackdropCloseIcon.svelte` | 8 | — | ⏳ |  |  |
| `ButtonIndicator.svelte` | 18 | — | ⏳ |  |  |
| `CloseAllButton.svelte` | 34 | — | ⏳ |  |  |
| `CloseIcon.svelte` | 18 | — | ⏳ |  |  |
| `ForceClose.svelte` | 43 | — | ⏳ |  |  |
| `ModalError.svelte` | 19 | — | ⏳ |  |  |
| `Skeleton.svelte` | 29 | — | ⏳ |  |  |
| `WarningIcon.svelte` | 23 | — | ⏳ |  |  |
| `index.ts` | 12 | — | ⏳ |  |  |
| `variants.ts` | 91 | — | ⏳ |  |  |

## `src/lib/ui/paginator/`

| Файл | Строк | Оценка | Статус | Замечания (критерии) | Предскан |
|---|---:|:---:|:---:|---|---|
| `EmptyState.svelte` | 35 | — | ⏳ |  | untrack×1 |
| `EndRow.svelte` | 36 | — | ⏳ |  | untrack×1 |
| `ErrorRow.svelte` | 41 | — | ⏳ |  | untrack×1 |
| `EventLog.svelte` | 50 | — | ⏳ |  | untrack×1 |
| `LoadMoreLink.svelte` | 81 | — | ⏳ |  |  |
| `LoadingIndicator.svelte` | 38 | — | ⏳ |  | untrack×1 |
| `PageColumns.svelte` | 190 | — | ⏳ |  | $effect×1, untrack×1 |
| `PageDivider.svelte` | 25 | — | ⏳ |  |  |
| `PageLink.svelte` | 93 | — | ⏳ |  | untrack×1 |
| `PageList.svelte` | 80 | — | ⏳ |  | untrack×1 |
| `PageNav.svelte` | 120 | — | ⏳ |  | untrack×1 |
| `PaginatorSettings.svelte` | 115 | — | ⏳ |  | window/document×2, untrack×1 |
| `PaginatorSettingsForm.svelte` | 201 | — | ⏳ |  | svelte-ignore×2 |
| `ReplaceLoadingRow.svelte` | 36 | — | ⏳ |  | untrack×1 |
| `ResetButton.svelte` | 31 | — | ⏳ |  | untrack×1 |
| `Skeleton.svelte` | 15 | — | ⏳ |  |  |
| `Spinner.svelte` | 34 | — | ⏳ |  |  |
| `StatusRow.svelte` | 22 | — | ⏳ |  |  |
| `compile.test.ts` | 165 | — | ⏳ |  |  |
| `compile.ts` | 229 | — | ⏳ |  |  |
| `event-log.ts` | 19 | — | ⏳ |  | any×1 |
| `index.ts` | 25 | — | ⏳ |  |  |
| `types.ts` | 55 | — | ⏳ |  |  |

## `src/lib/ui/primitives/`

| Файл | Строк | Оценка | Статус | Замечания (критерии) | Предскан |
|---|---:|:---:|:---:|---|---|
| `AffixSwap.svelte` | 41 | — | ⏳ |  |  |
| `Alert.svelte` | 49 | — | ⏳ |  |  |
| `AutoTextarea.svelte` | 55 | — | ⏳ |  | addEventListener×1 |
| `AutoWidthInput.svelte` | 23 | — | ⏳ |  |  |
| `Badge.svelte` | 54 | — | ⏳ |  |  |
| `Button.svelte` | 81 | — | ⏳ |  | $effect×1 |
| `ButtonGroup.svelte` | 26 | — | ⏳ |  |  |
| `Card.svelte` | 39 | — | ⏳ |  |  |
| `CardContent.svelte` | 19 | — | ⏳ |  |  |
| `CardDescription.svelte` | 19 | — | ⏳ |  |  |
| `CardFooter.svelte` | 19 | — | ⏳ |  |  |
| `CardHeader.svelte` | 19 | — | ⏳ |  |  |
| `CardTitle.svelte` | 19 | — | ⏳ |  |  |
| `Checkbox.svelte` | 37 | — | ⏳ |  |  |
| `Fieldset.svelte` | 30 | — | ⏳ |  |  |
| `Input.svelte` | 17 | — | ⏳ |  |  |
| `InputAffix.svelte` | 27 | — | ⏳ |  |  |
| `InputShell.svelte` | 19 | — | ⏳ |  |  |
| `Label.svelte` | 40 | — | ⏳ |  |  |
| `NativeSelect.svelte` | 22 | — | ⏳ |  |  |
| `NumberField.svelte` | 87 | — | ⏳ |  |  |
| `OtpInput.svelte` | 138 | — | ⏳ |  |  |
| `PasswordInput.svelte` | 90 | — | ⏳ |  | microtask×1, addEventListener×1 |
| `PasswordStrength.svelte` | 161 | — | ⏳ |  |  |
| `PhoneField.svelte` | 120 | — | ⏳ |  |  |
| `SearchField.svelte` | 50 | — | ⏳ |  |  |
| `SearchInput.svelte` | 65 | — | ⏳ |  | addEventListener×1 |
| `SearchMorph.svelte` | 144 | — | ⏳ |  | window/document×2, rAF×1, addEventListener×1 |
| `Select.svelte` | 861 | — | ⏳ |  | $effect×5, window/document×15, setTimeout×1, microtask×2, untrack×1, addEventListener×7 |
| `SelectList.svelte` | 562 | — | ⏳ |  | $effect×3, window/document×1, rAF×1 |
| `Separator.svelte` | 50 | — | ⏳ |  |  |
| `Skeleton.svelte` | 38 | — | ⏳ |  |  |
| `Spinner.svelte` | 41 | — | ⏳ |  |  |
| `Stat.svelte` | 64 | — | ⏳ |  |  |
| `Switch.svelte` | 38 | — | ⏳ |  |  |
| `Textarea.svelte` | 18 | — | ⏳ |  |  |
| `field.ts` | 14 | — | ⏳ |  |  |
| `index.ts` | 46 | — | ⏳ |  |  |
| `select-model.test.ts` | 66 | — | ⏳ |  |  |
| `select-model.ts` | 77 | — | ⏳ |  |  |
| `select-trace.ts` | 232 | — | ⏳ |  | window/document×14, setTimeout×1, addEventListener×1 |

## `src/lib/ui/settings/`

| Файл | Строк | Оценка | Статус | Замечания (критерии) | Предскан |
|---|---:|:---:|:---:|---|---|
| `Field.svelte` | 27 | — | ⏳ |  |  |
| `Select.svelte` | 42 | — | ⏳ |  |  |
| `Toggle.svelte` | 65 | — | ⏳ |  |  |
| `index.ts` | 4 | — | ⏳ |  |  |

## `src/routes/`

| Файл | Строк | Оценка | Статус | Замечания (критерии) | Предскан |
|---|---:|:---:|:---:|---|---|
| `+error.svelte` | 23 | 8 | прочитан | `$app/state` `page.status` по документации +error (K3). −2 K7: `role="alert"` на `<main>` заменяет роль ориентира main: страница ошибки теряет landmark, а alert срабатывает как живая область при загрузке. | $app/×1 |
| `+layout.svelte` | 192 | 6 | прочитан | Runes, `$app/state`, `untrack` с причиной (K1, K2). −2 K3/K10 (костыль C2): корневой layout решает за маршруты по `page.route.id` (`OWN_SYSTEM`, `ROUTE_SCOPES`). В SvelteKit для этого есть группы маршрутов `(group)/+layout` и `@`-сброс layout. −1 K10: `scope` дублирует условие `/modals` (`startsWith` + `route.id` + `ROUTE_SCOPES` с единственным ключом). −1 K2: синхронизация ядра двумя `$effect` с ручным сравнением `appliedNames/appliedLookup` (обоснованно: внешний стор, но громоздко). | $effect×2, $app/×1, untrack×2 |
| `+page.svelte` | 83 | 9 | прочитан | Статическая витрина, SSR-чистая. −1 K3: `import.meta.env.DEV` вместо `dev` из `$app/environment` (документированный способ в SvelteKit). | window/document×1 |

## `src/routes/api/db-posts/`

| Файл | Строк | Оценка | Статус | Замечания (критерии) | Предскан |
|---|---:|:---:|:---:|---|---|
| `+server.ts` | 70 | 7 | прочитан | Тонкий `+server`, условный GET/ETag до чтения БД (K3). −1 K4: кэш ETag (`$lib/server/live-cache`) — общее изменяемое состояние модуля с ключом только `url.search`, без принципала: при разных правах у пользователей 304 может отдаться по чужому отпечатку (в демо принципал один). −1 K9: `locals.dbCtx ?? …` — запасной путь при типе без `undefined` (мёртвая ветка либо неверный тип). −1 K10: опечатка в комментарии («совпел»). | @sveltejs/kit×1 |

## `src/routes/api/shikimori/animes/`

| Файл | Строк | Оценка | Статус | Замечания (критерии) | Предскан |
|---|---:|:---:|:---:|---|---|
| `+server.ts` | 38 | 9 | прочитан | Тонкий `+server`, разбор deny-safe, `request.signal` проброшен. −1 K4: текст ошибки апстрима (`String(error)`) уходит клиенту как есть. | @sveltejs/kit×1 |

## `src/routes/api/shikimori/filters/`

| Файл | Строк | Оценка | Статус | Замечания (критерии) | Предскан |
|---|---:|:---:|:---:|---|---|
| `+server.ts` | 24 | 9 | прочитан | Тонкий `+server`. −1 K4: `String(error)` апстрима уходит клиенту. | @sveltejs/kit×1 |

## `src/routes/api/shikimori/terms/`

| Файл | Строк | Оценка | Статус | Замечания (критерии) | Предскан |
|---|---:|:---:|:---:|---|---|
| `+server.ts` | 23 | 9 | прочитан | Тонкий `+server`, `request.signal` проброшен. −1 K4: `String(error)` апстрима уходит клиенту. |  |

## `src/routes/cards/[id]/`

| Файл | Строк | Оценка | Статус | Замечания (критерии) | Предскан |
|---|---:|:---:|:---:|---|---|
| `+page.svelte` | 23 | 9 | прочитан | Чистый вывод `data`. −1 K9: тип пропсов собран вручную (`{ data: PageData }`) вместо `PageProps` из `./$types` (Kit ≥2.16). |  |
| `+page.ts` | 15 | 10 | прочитан | Universal `load` с типами `./$types`; задержка `slow=1` — заявленная демонстрация ожидания. | setTimeout×1 |

## `src/routes/cycle/`

| Файл | Строк | Оценка | Статус | Замечания (критерии) | Предскан |
|---|---:|:---:|:---:|---|---|
| `+page.svelte` | 8 | 10 | прочитан | Тонкий маршрут, демо — в `$lib/ui/demo/cycle` (соглашение проекта). |  |

## `src/routes/db-demo/`

| Файл | Строк | Оценка | Статус | Замечания (критерии) | Предскан |
|---|---:|:---:|:---:|---|---|
| `+page.server.ts` | 58 | 8 | прочитан | load + form actions + `fail` по документации, ошибки слоя переводятся в `error()` (K3, K6). −1 K1: `throw error(...)` — идиома Kit 1; с Kit 2 `error()` бросает сам (migration guide v2). −1 K3: `import.meta.env.DEV` вместо `dev`. | @sveltejs/kit×1 |
| `+page.svelte` | 78 | 8 | прочитан | `form` выводится через `$derived`, а не копируется (K2). −1 K9: `form` типизирован вручную (`FormOutcome`) и приводится `as`, вместо `PageProps`/`ActionData`: связь с реальными экшенами теряется. −1 K10: регистрация пагинатора вызовом с побочным эффектом в теле компонента (`ensureDbListPaginator()`), порядок важен (описан в комментарии). |  |

## `src/routes/db-demo/submit/`

| Файл | Строк | Оценка | Статус | Замечания (критерии) | Предскан |
|---|---:|:---:|:---:|---|---|
| `+server.ts` | 18 | 9 | прочитан | Тонкий `+server` с `json()`; origin проверяет общий конвейер. −1 K10: «магический» статус `0 → 200` (контракт `Handled` выражен числом-сигналом). | @sveltejs/kit×1 |

## `src/routes/form/`

| Файл | Строк | Оценка | Статус | Замечания (критерии) | Предскан |
|---|---:|:---:|:---:|---|---|
| `+page.server.ts` | 11 | 9 | прочитан | Default action + `fail` по документации (K3, K6). −1 K10: тот же статус-сигнал из `Handled`, что и в `/form/submit`. | @sveltejs/kit×1 |
| `+page.svelte` | 588 | 4 | прочитан | Нативная форма с перехватом и SSR-продолжением (K6). −2 K2 (костыль C3): `$effect` синхронизирует состояние: зеркало панели → `opts` (стр. 275–281), `cardinality` → `opts.specVersion` (169), `form.state` → `channelLog` (230–234, это `$derived`). Ещё эффект «пропусти первый запуск» пишет в настройки (264–271), хотя комментарий сам называет это бывшим `onChange`. Документация: состояние выводится через `$derived` или геттеры, а не эффектом. −2 K10: ~280 строк логики демо прямо в маршруте, хотя у остальных демо маршрут тонкий, а логика в `$lib/ui/demo/<x>`. Импорты разорваны вставкой `const jsOnly = useJsOnly()` со сбитым отступом (след правки «6.4»). −1 K9: `form` типизирован вручную вместо `PageProps`, `PSP_SAMPLES[sample]!`. −1 K10: ключ строки `r${Date.now() % 100000}` может совпасть. | $effect×5, svelte-ignore×2, untrack×2 |

## `src/routes/form/submit/`

| Файл | Строк | Оценка | Статус | Замечания (критерии) | Предскан |
|---|---:|:---:|:---:|---|---|
| `+server.ts` | 9 | 9 | прочитан | Тонкий `+server`. −1 K10: магический `status === 0 ? 200`. | @sveltejs/kit×1 |

## `src/routes/modals/`

| Файл | Строк | Оценка | Статус | Замечания (критерии) | Предскан |
|---|---:|:---:|:---:|---|---|
| `+page.svelte` | 215 | 7 | прочитан | Runes, живой контекст `useModals()` (K1, K2). −1 K10: разорванные импорты (`const jsOnly` между import, отступ сбит — след правки «6.4»). −1 K10: устаревший комментарий «страницы /paginator в порте нет» (она есть). −1 K10: в отличие от прочих демо, разметка демо живёт в маршруте, а не в `$lib/ui/demo/modals`. |  |

## `src/routes/paginator/`

| Файл | Строк | Оценка | Статус | Замечания (критерии) | Предскан |
|---|---:|:---:|:---:|---|---|
| `+page.server.ts` | 16 | 10 | прочитан | Тонкий server load, вся логика — в `loader` демо; решение о чистке адреса задокументировано. |  |
| `+page.svelte` | 21 | 9 | прочитан | Тонкий маршрут. −1 K9: ручной `interface Props { data: PageData }` вместо `PageProps`. |  |

## `src/routes/spike/`

| Файл | Строк | Оценка | Статус | Замечания (критерии) | Предскан |
|---|---:|:---:|:---:|---|---|
| `+page.svelte` | 8 | 10 | прочитан | Тонкий маршрут, демо — в `$lib/ui/demo/spike`. |  |
