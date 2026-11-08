# Этап 1: поиск и фильтры на bindComponentForm

Запись для продолжения. Второй этап: `PopupSteps` через хост модалок, в фильтры не встроен. CSS-резерв sidebar не начат. Не пушить.

## Задача

Поиск и обе формы фильтров (seed и блокировки) работают без GET.

- С JS debounce поиска и «Применить» зовут `setExtra`. `pageSize` — опция, не ключ extra. Адрес пишет адаптер.
- Без JS — нативный POST `bindComponentForm`, конверт в HTML, `303` на адрес из `linkFor` / `hrefFor` по `from` в теле.
- Нет `hrefFor` — явный `fail`, не поддельный GET.
- На страницах фильтров база search — `from`, не `event.url`.
- Слот sidebar и значения фильтров есть в SSR из `initial`, не из эффекта клиентского стора.
- Имена полей фиксированы в описании. Сервер не выводит схему из тела POST. Права — в `execute`.

## Состояние

Код этапа — коммит `70aeb2e` (`fix(user): поиск и фильтры без JS через POST`). Дерево до этой проверки было чистым.

Проверка кода:

- Поиск: `src/components/paginator/search-form.ts`, хук `search.svelte.ts`, сервер `src/content/user/ui/search.form.server.ts`. JS не зовёт `form.commit()`. Без JS `onsubmit` не перехватывает.
- Фильтры: одно описание на sidebar, модалку и страницу. `applySeedFilters` / `applyBlocksFilters` отдают patch и `pageSize` отдельно. Сервер зовёт `listHref`.
- `listHref` (`src/lib/paginate/list-href.ts`) собирает адрес адаптером. Чужой путь и отсутствие пагинатора — `null`.
- Страницы `/users/filters` и `/blocks/filters` передают `from={data.backHref}`.
- Пикер блокировок по-прежнему пишет `blocks.uids`. Сферы — статический `BLOCK_SCOPES`.

Гейт этого хода: `vitest run` четырёх файлов (list-href, filters-form, BlocksUi.ssr, sidebar) — 14 passed.

Не проверено живым браузером: что слот sidebar с формой попал в HTML страницы `/users` и `/blocks`. Порядок в `AppShell` — main до aside, регистрация слота синхронная. Отдельного SSR-прогона страницы нет.

Контракт `docs/design/lists.md` всё ещё описывал GET. Это поправлено в этом ходе, иначе второй этап снова взял бы GET.

## Не делать

- Встраивать `PopupSteps` в формы фильтров, пока не попросят. Свою absolute-панель не возвращать.
- CSS-резерв sidebar и возврат `ready`. Этап 3 не начинать.
- Push.
- Чинить `vite.config.ts` этим diff.

## PROCEDURE

1. Нет правки до git. Репозиторий есть, push не нужен.
2. Коммит после зелёного гейта, не «когда этап кажется конченым».
3. «Готово» только с блоком доказательств. Пустое поле — утверждения нет.
4. Невыполненное требование называется вслух.
5. После поправки пользователя — стоп, ответ, ждать решения. Правок нет, пока решения нет.

VCS: репозиторий `/home/user/repos/modals-kit-update`, ветка `img`. Переделка `PopupSteps` — коммит этого хода. Не пушить.

Пропущенное: Playwright не запускался. Полный lint/test/build не гонялся. `npm run check` упирается в старый `vite.config.ts` — не чинить. Живой SSR страницы списка со слотом sidebar не снят. Демо `/steps` локально, в git `img` его нет.
