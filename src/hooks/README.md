# `src/hooks` — связки между библиотеками и средой

Библиотеки в `src/lib` не знают друг о друге: у каждой своё чистое ядро без чужих импортов (`tooling/core-purity.mjs`). Когда двум библиотекам или библиотеке и серверному конвейеру SvelteKit нужно работать вместе, переходник пишется **здесь**, а не внутри одной из них — оба ядра остаются переносимыми по отдельности.

---

## Состав папки

| Модуль | Что соединяет | Роль |
|---|---|---|
| `api-error.ts` | клиент / SSR × формат ошибок API | Изоморфный разбор и человекочитаемое представление ошибок API без затягивания серверных секретов в клиентский бандл. |
| `app-errors.svelte.ts` | UI-оболочка × ошибки приложения | Реактивное хранилище глобальных уведомлений об ошибках. |
| `cache-db.ts` | `#lib/cache` × `#lib/db` | Общее между инстансами KV-хранилище в PostgreSQL (`pgStore`, ресурс `cacheKv` → таблица `public.cache_kv`), часы базы (`clock_timestamp()`), атомарные `add`/`incr` и оппортунистическая вычистка просроченных строк. В приложении экземпляр экспортируется как `sharedStore` из `src/server/cache.server.ts`. |
| `component-form/` | `#lib/form` × SvelteKit `Handle` / `$app/state` | Маршрутно-независимые формы компонентов: компонент со своей формой (`SeedForm`, `ProfileForm`, `MenuBody`, `/fields`) монтируется на любой странице или в модалке без `actions` в `+page.server.ts`. |
| `db-form.ts` | `#lib/db` × `#lib/form` | Вывод параметров и валидаторов полей формы из дескриптора ресурса БД (`formParams(resource)`), включая доказательство полноты правил `rulesFrom` для `pick`. |
| `graphql.server.ts` | `#lib/fetch` × GraphQL | Серверный адаптер запросов к внешним GraphQL-источникам с нормализацией ошибок и очередей. |
| `js-only.svelte.ts` | гидратация Svelte 5 | Реактивный флаг оживления клиента после гидратации (` hydrated()`). |
| `links/` | `#lib/modals` × SvelteKit `<a>` | Перехват переходов по ссылкам (`asLink`) для бесшовного открытия модальных маршрутов поверх текущей страницы с graceful degradation без JS. |
| `loader.svelte.ts` | `$app/state` navigating × UI | Отложенный индикатор навигации без мелькания на быстрых переходах. |
| `task-stream.server.ts` | `#lib/task` × HTTP NDJSON | Серверный ответ `taskResponse(request, run, { watch })` с потоковой отдачей шагов задачи. |
| `use-drawer.svelte.ts` | `matchMedia` × UI-шторки | Реактивное переключение мобильной шторки / десктопной панели. |

---

## Папочный модуль `component-form/`

Многофайловые хуки оформляются отдельной папкой с чётким разделением клиентской и серверной точек входа:

- `index.ts` — публичный клиентский вход (`bindComponentForm`, типы `ComponentFormOptions`, `FormSessionGuard`).
- `client.svelte.ts` — привязывает `<Form>` и `kitActionTransport` к текущему видимому адресу (`visibleAddress().url`), подхватывает одноразовый `page.data.formResult` своего `formId` после нативного `POST` без JS (включая `lockStateKey` и `onSuccess`) и при переданном `session: FormSessionGuard` прозрачно обновляет мёртвый временный снимок и повторяет запрос 1 раз при `auth.expired`.
- `server.server.ts` — `registerComponentForm(reg)`, `componentFormsHandle` и фабрика `createComponentFormsHandle(modules)` для композиции в `src/hooks.server.ts` (`import.meta.glob('./**/*.form.server.ts', { eager: true })`) с дедупликацией `Set-Cookie` по имени куки:
  - `GET` и чужие `POST` проходят в `resolve(event)` без накладных расходов;
  - с JS (`Accept: application/json`) возвращает `{ data: { result } }` со статусом обработчика и выставленными `Set-Cookie`;
  - без JS при успехе делает `303 See Other` (или рендерит ответ в том же запросе при `'inline'` / `outcome === 'not-applied'`);
  - без JS при ошибке рендерит текущую страницу прямо в ответе на этот же `POST` с кодом ошибки (`422` и др.) и `locals.formResult = result`, сохраняя введённые значения.
- `transport.ts` — клиентский транспорт отправки формы в текущий маршрут.
- `types.ts` — контракты регистрации и опций.

---

## Правило добавления новых связок

- Одиночный компактный переходник без внутренних подмодулей — один файл `src/hooks/<имя>.ts` (и `<имя>.test.ts` рядом); строго серверные связки носят суффикс `*.server.ts`.
- Связка из нескольких файлов (раздельные `client` / `server.server` / `types`) — отдельная папка `src/hooks/<имя>/` с явными точками входа.
- Внутри `src/hooks/` нет визуальной разметки и доменных текстов: разметка и домен живут в `src/content/<модуль>/` и `src/components/`.
