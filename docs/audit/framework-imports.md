# Импорты фреймворка в `src/lib` (задача 4)

Вопрос: все ли библиотеки `src/lib` работают с SvelteKit через адаптеры, без прямых импортов.

**Состояние на коммите:** см. `git log` у этого файла. Метод — ниже, его можно повторить.

## Определения

- **Фреймворк** — модули SvelteKit: `$app/*`, `@sveltejs/kit`, `$env/*`.
- **Адаптер** — модуль, чья задача и есть связать библиотеку с фреймворком. В проекте это
  `$lib/router/sveltekit.ts` (роутер пагинатора и форм, срез адреса), `$lib/router/LoadLink.svelte`
  (ссылка роутерного слоя) и `$lib/modals/cores/sveltekit.ts` (движок истории модалок).
  Импорт фреймворка **внутри** адаптера — норма.
- Рантайм `svelte` (`$state`, `setContext`, `svelte/reactivity`) фреймворком SvelteKit не считается:
  он ожидаем в Svelte-биндингах (`*/svelte/`), в UI-компонентах и в оболочке `lib/shell`.
  Импортов `svelte` в нейтральных ядрах (`lib/paginate/*.ts`, `lib/form/*.ts`, `lib/modals/*.ts`,
  `lib/db`, `lib/search`, `lib/filters`, `lib/links`) **нет**.

Документация, на которую опирается вывод
([packaging → best practices](https://svelte.dev/docs/kit/packaging#Best-practices)):
библиотеке стоит избегать `$app/*`; признак окружения брать из `esm-env`, а текущий URL или
действие навигации передавать параметром, а не читать из `$app/state`/`$app/navigation`.

## Метод (воспроизводимо)

```sh
grep -rnE "from ['\"](\$app/[a-z]+|@sveltejs/kit[^'\"]*|\$env/[a-z/]+)['\"]" src/lib --include=*.ts --include=*.svelte
```

Каждое совпадение прочитано в контексте.

## Итог

| # | Место | Импорт | Вердикт | Что делать |
|---|---|---|---|---|
| 1 | `lib/router/sveltekit.ts:17-20` | `$app/environment`, `$app/navigation`, `$app/state`, `svelte/reactivity` | **Адаптер** — норма | — |
| 2 | `lib/router/LoadLink.svelte:13-14` | `$app/navigation` (`goto`); `preloadData` с хода 6 — через `preloadOutcome` адаптера | **Адаптер** (роутерный слой) — норма | — |
| 3 | `lib/modals/cores/sveltekit.ts:12-14` | `$app/environment`, `$app/navigation`, `$app/state` | **Адаптер** (движок модалок) — норма | — |
| 4 | `lib/components/sidebar/SidebarNav.svelte:21,30` | `$app/state` → `page.url.pathname` | **Обход адаптера** | Активный пункт меню — через `currentPathname()` из `$lib/router/sveltekit` (уже есть). |
| 5 | `lib/components/header/NavSlot.svelte:23,29` | `$app/state` → `page.url.pathname` | **Обход адаптера** | То же, `currentPathname()`. |
| 6 | `lib/ui/demo/paginator/DemoPaginator.svelte:4,431` | `$app/state` → `page.url.search` | ~~Обход адаптера + подтверждённый баг (F5)~~ **исправлено в ходе 5**: импорта `$app/state` больше нет | `currentSearch()` из `$lib/router/sveltekit`; см. ниже. |
| 6а | `lib/shell/use-drawer.svelte.ts:42` | нативный `history.pushState` (не `$app/*`, но мимо роутера) | ~~Обход роутера, баг F6~~ **исправлено в ходе 5** | `shallowFlag()` в `$lib/router/sveltekit` (`pushState` + `page.state`) |
| 7 | `lib/ui/demo/paginator/FiltersPanel.svelte:15,44` | `$app/state` → `page.url.pathname` (значение пропса по умолчанию) | **Обход адаптера** | `currentPathname()`; путь при «мелких» записях не меняется, бага нет. |
| 8 | `lib/ui/demo/spike/SpikeDemo.svelte:3-4` | `$app/navigation`, `$app/state` | **Обход адаптера, обоснованный**: спайк исследует поведение истории SvelteKit (`pushState` против `goto`), то есть сам фреймворк | Оставить; по смыслу это прикладной код маршрута `/spike`, а не библиотека. |
| 9 | `lib/modals/svelte/media.svelte.ts:3,15` | `$app/environment` (`browser`) | **Лишний импорт фреймворка** в Svelte-биндинге | Проверка `if (!browser) return` стоит внутри `$effect`, а `$effect` на сервере не выполняется вовсе: импорт и проверку можно убрать. Если признак окружения нужен — `esm-env` (`BROWSER`). |

| 10 | ~~`lib/server/db.ts:20`, `lib/server/form-security.ts:18,32,36`~~ | `process.env` вместо `$env/dynamic/private` | ~~Обход модуля окружения фреймворка (C7)~~ **исправлено в ходе 7** (9ba827b) | `$env/dynamic/private`; чтение при вызове/первой проверке. Ход 16 (переезд на Kit 3, A2): `$env/dynamic/private` → `$app/env/private`, перечень и проверки — `src/env.ts`; `envReader` в приложении больше не нужен. |
| 11 | ~~`lib/server/shikimori-filters.ts:257`, `lib/server/shikimori-schema.ts:314`, `lib/filters/catalog-filter.ts:388`, `lib/paginate/adapter-url.ts:124`, `lib/paginate/source.ts:177`~~ | `process.env.NODE_ENV` как признак dev | ~~Обход (C7)~~ **исправлено в ходе 7** (9ba827b) | `DEV` из `esm-env` во всех пяти местах (решение владельца). |

Строки 10–11 добавлены в ходе 6 при чтении `lib/server`: модулей `$env/*` в `src/` нет вовсе (`grep -rn '\$env/' src` — пусто).

**`lib/paginate` (ход 8, 26 файлов прочитаны целиком).** Прямых импортов `$app/*`, `@sveltejs/kit`,
`$env/*` нет. Признак dev — `DEV` из `esm-env` (`adapter-url.ts:12`, `source.ts:21`). Единственная
связь с SvelteKit — `svelte/PaginatorHost.svelte` импортирует адаптер `$lib/router/sveltekit`
(`currentSearch`, `svelteKitRouter`) — это норма (адаптер, канон D2), но из-за неё Svelte-биндинги
пагинатора работают только под SvelteKit. Остаётся K8: признак окружения через `typeof window`
(`source.ts` `isServerSide`, `adapter-url.ts`, `svelte/context.svelte.ts`, `svelte/PaginatorScope.svelte`)
вместо `BROWSER` из `esm-env`.

### Ложные совпадения (импорта нет)

| Место | Почему ложное |
|---|---|
| `lib/db/sveltekit/context.ts:4` | Строка `import type { Handle, RequestEvent } from '@sveltejs/kit'` стоит **в комментарии**: модуль сознательно описывает структурные типы, чтобы `lib/db` проверялся без установленного SvelteKit. Хороший пример изоляции. |
| `lib/modals/cores/sveltekit.ts:163` | `import { resolve } from '$app/paths'` — пример в JSDoc. |

## F5 — подтверждённый баг из-за обхода адаптера

`DemoPaginator.svelte:431` передаёт в `FiltersPanel` поле `preserved={demoPreservedSearch(page.url.search)}`.
Из него строятся `action` нативной формы фильтров, её скрытые поля и ссылка сброса.
`page.url` при «мелкой» записи истории не обновляется (shallow routing; так пишет адрес пагинатор),
поэтому эти значения устаревают.

Проба (`~/.agent/probes/preserved_probe.py`, dev): `/paginator?page.src=animes&page.size=10`,
затем размер страницы 20 в панели.

```
before {'loc': '?page.src=animes&page.size=10', 'action': '/paginator?page.size=10&page.src=animes', 'hidden': ['page.src=animes', 'page.size=10'], ...}
after  {'loc': '?page.src=animes',              'action': '/paginator?page.size=10&page.src=animes', 'hidden': ['page.src=animes', 'page.size=10'], ...}
RESULT: STALE (bug)
```

Видимый эффект: ссылка «сбросить» фильтров и форма без перехвата вернут старый размер страницы.
Исправление в одну строку: `demoPreservedSearch(currentSearch())` через адаптер роутера
(после `8369674` он отдаёт живой адрес). **Не исправлено**: задача была записать — жду решения.

## Смежное: зависимость `lib` от прикладной папки `src/content`

Это не импорт фреймворка, но нарушение того же правила слоёв (K8): библиотечный код тянется
относительными путями из `src/lib` наружу.

| Откуда | Что |
|---|---|
| `lib/server/shikimori.ts:36`, `lib/server/shikimori-schema.ts:38`, `lib/server/shikimori-filters.ts:34` | `../../content/shikimori*` |
| `lib/ui/demo/paginator/*` (10 файлов) | `../../../../content/items`, `…/shikimori*` |

Для демо это терпимо (демо — прикладной код, лежащий в `lib/ui/demo` по соглашению проекта).
Для `lib/server` правильнее перенести типы и источники Shikimori в `$lib` (например,
`$lib/server/shikimori/` или `$lib/content/`) либо завести subpath-импорт в `package.json#imports`.

## Замечание на будущее: `$app/environment` → `$app/env`

В текущей документации [`$app/environment`](https://svelte.dev/docs/kit/$app-environment) помечен:
«deprecated in SvelteKit 3 in favour of `$app/env`». В установленном SvelteKit 2.70.3 есть оба
модуля (`node_modules/@sveltejs/kit/types/index.d.ts`, `declare module '$app/env'`). Сейчас это
не ошибка; при переходе на SvelteKit 3 затронет места 1, 3, 9.

## Ход 9: остатки C7 в `lib/form`

Решение хода 7 — признак dev через `DEV` из `esm-env` — в `lib/form` не применено:

| Файл | Что |
|---|---|
| `lib/form/keep.ts` | `import.meta.env?.DEV` |
| `lib/form/svelte/bind.svelte.ts:185,424,436` | `import.meta.env.DEV` (+ `typeof window` на стр. 365, K8) |
| `lib/form/react/bind.ts:174,323,335`, `lib/form/solid/bind.ts:163,489,501` | `import.meta.env.DEV` (зоны C9) |

`import.meta.env` — соглашение Vite: README библиотеки обещает «ядро приезжает исходниками и не
зависит от сборщика», а `keep.ts` лежит в ядре. ~~Не исправлено~~ **Исправлено в ходе 10** (c3d72df):
во всех пяти файлах — `DEV` из `esm-env`; `keep.test.ts` проверяет обе ветки через мок `esm-env`.

**Исключение (решение владельца, ход 10):** страж `tooling/form-size.mjs` запрещает ядру `lib/form`
внешние импорты; `esm-env` — единственный разрешённый пакет (`ALLOWED_PACKAGES`), с причиной в коде и
тестом. Причина: это стандартный для библиотек Svelte-экосистемы способ узнать окружение без
сборщика и без `$app/*`; размер — несколько строк. Другие пакеты в ядро формы по-прежнему не
допускаются. Признак `typeof window` в `svelte/bind.svelte.ts` (K8) остаётся открытым замечанием.
