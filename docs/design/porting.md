# Перенос на другой фреймворк / роутер

Это инструкция, не очередь работ. Порядок: **ядра → адаптеры фреймворка → примитивы → фичи → страницы**. Каждый уровень опирается только на предыдущие.

Шаги **2–5** доказаны симуляцией на **React 19 + React Router v7** в [`sim/react-router/`](../../sim/react-router/README.md) (те же исходники ядер `src/core/lib/*`, ноль `svelte` в `node_modules`). Шаги **6–10** описывают перенос прикладной сборки, когда он понадобится. Вынос русских строк из `src/core/lib/` (шаг 1) отложен вместе со второй локалью: [`docs/pending.md`](../pending.md).

---

1. **Тексты UI в `src/core/lib/`** — перед выделением пакетов или сменой языка интерфейса вынести русские строки из ядер и адаптеров в словари/опции по образцу `src/core/lib/form/messages.ts`. Текущий перечень мест в `src/core/lib/`:
   - `src/core/lib/form/messages.ts`, `src/core/lib/form/validate.ts` — словарь сообщений валидаторов и склейка списков (`«…» и «…»`); в `svelte/{config.ts,bind.svelte.ts,field-set.svelte.ts}` — диагностика конфигурации/разметки и `'транспорт не настроен'`.
   - `src/core/lib/modals/loader.ts` — `'Ошибка загрузки'`, `'Нет такой модалки: «…»'`, `'Маршрут …: …'`, `'Отменено'`.
   - `src/core/lib/modals/{core-contract.ts,registry.ts}` и `src/core/lib/modals/svelte/{ModalHost.svelte,ModalContent.svelte,state.svelte.ts,context.ts}` — диагностические ошибки областей/слоёв, `'Закрыть модалку'`, `'(i из N)'`.
   - `src/core/lib/address/keys.ts` — ошибки пересечения и прав реестра ключей адреса; `src/core/lib/address/sveltekit.ts` — подпись задачи `'Переход'`.
   - `src/core/lib/task/index.ts` — форматтер подписи `'шаг i из N'`.
   - `src/core/lib/paginate/{core.ts,source.ts,adapter-url.ts}` и `src/core/lib/paginate/filters/{schema.ts,params.ts}` — dev-предупреждения и ошибки контракта источника/ключей.

2. **`#core/lib/address` — адаптер роутера** *(доказано в `sim/react-router/src/address.ts`)*.
   Ядро (`src/core/lib/address/{core,keys,layer-links}.ts`) чистое. Написать модуль взамен `src/core/lib/address/sveltekit.ts` + `svelte/watch.svelte.ts`: чтение видимого адреса с подпиской, запись query/state одной очередью, задачи навигации и ссылок (`navigationTask`, `linkTask`).

3. **`#core/lib/modals` — движок роутера + адаптер компонентного фреймворка** *(доказано в `sim/react-router/src/modals.tsx`)*.
   Ядро чистое, контракт — `ModalCore` (`core-contract.ts`) + `ChainEngine` (`engine.ts`). Написать `cores/<router>.ts` по образцу `cores/sveltekit.ts` / `cores/fastedge.ts`, плюс реактивный хост и хуки взамен `src/core/lib/modals/svelte/` (`ModalHost`, `Layers`, `ModalContent`, `Tails`, `useModals`, `useModal`, `useModalState`, `useModalLink`).

4. **`#core/lib/form` — адаптер реактивности и транспорт** *(доказано в `sim/react-router/src/form.tsx`)*.
   Ядро чистое (`FormStore` совместим с `useSyncExternalStore`, `evaluate`/`runSubmit`/`createFormHandler` общие для клиента и сервера). Написать реактивную связку `bind` + компонент `<Form>` по образцу `src/core/lib/form/svelte/{bind.svelte.ts,Form.svelte,field-set.svelte.ts,task.ts}` (включая `FieldHandle` для `takeover`) и HTTP-транспорт под экшены целевого фреймворка взамен `src/core/hooks/component-form/transport.ts`.

5. **`#core/lib/paginate` (+ `filters`, `search`) — адаптер и роутер** *(ядро и React-хук доказаны в `sim/react-router/src/paginate.ts`)*.
   Ядро, `search/` и `filters/` чистые. Написать реактивную обвязку взамен `src/core/lib/paginate/svelte/` (`PaginatorHost`, `PageAnchor`, `EdgeSentinel`, `usePaginator*`, `paginatorTask`, `useSearchCorrection`) и мост к роутеру взамен `src/core/lib/paginate/sveltekit/router.ts` поверх `#core/lib/address` из шага 2.

6. **Серверные ядра и связки без UI** — `#core/lib/db` (`index.ts`, `schema.ts`, `sync/`, `adapters/*`, `ops.ts`), `#core/lib/cache`, `#core/lib/storage` (`index.ts`, `s3.ts`, `webdav.ts`, `local.ts`, `state.ts`), `#core/lib/fetch`, `#core/lib/image` (включая `#core/lib/image/node.js`), `#core/lib/task` и переходники `src/core/hooks/{cache-db.ts,storage-db.ts,db-form.ts,cookie-vault/*}` переносятся как есть. Заменяются только обвязки под `RequestEvent` SvelteKit:
   - `src/core/lib/db/sveltekit/*` (`dbHandle`, `toKitError`, `parseListInput`, `cursorCodecFromEnv`);
   - `src/core/hooks/component-form/{server.server.ts,ws-session.server.ts,client.svelte.ts}` — middleware приёма POST и `wss://`-загрузки встраиваемых форм компонентов по `__form_id` и клиентский хук `bindComponentForm`.

7. **Примитивы UI (`src/core/ui/**`)** — переписать на целевой фреймворк (Ark UI / Zag для React/Solid/Vue + те же CVA/UnoCSS-токены из `unocss.config.ts` и `src/app.css`), в том числе `Attachment` и `FileAttachment`. Сохранить контракт нативных носителей в `<Form>` до гидратации, если требуется работа без JS.

8. **Прикладные обвязки (`src/core/ui/{shell,modals,form,fields,paginator,steps,settings,demo,loader}/ и src/core/hooks/{links,loader.svelte.ts}`)**:
   - `links/` (`asLink`, `asModalLink`) и `loader/` (`LoaderBar`, `trackTask`) — поверх `#core/lib/address` и `#core/lib/task`;
   - `form/` (`Field` с `takeover`/`instead`, `FieldShell`, компоненты видов ввода, `photo.ts`, `extend.ts`);
   - `steps/` (`useSteps`, `Steps`, `StepLink`, `formSteps`, `FormSteps`);
   - `paginator/` и `filters/` (`FiltersPanel`, `ActiveFilters`, `bindFilters`);
   - `shell/`, `header/`, `sidebar/`.

9. **Контент и модуль пользователя (`src/modules/**`)** — перенести без правок доменное ядро `src/modules/user/{acl,auth,checks,config,error,keys,ports,profile,schema,types,vault}.ts`. Каталоги `items` / `posts` / `shikimori` / `rickmorty` не лежат в чистом ядре: их приносит опциональный модуль `demo` (`npm run mod -- add demo`). Переписать под целевой фреймворк:
   - `src/modules/user/base/service/gateway.server.ts` (куки и серверный фасад запроса);
   - `src/modules/user/base/svelte/vault.svelte.ts` (реактивное клиентское зеркало `vault`);
   - UI-слой `src/modules/user/` (`Acl`, `AuthWidget`, `MenuBody`, `UserMenu`, `BanNotice`, `RestrictionsNotice`, папочные модули `ui/seed-form/` и `ui/profile-form/`).

10. **Серверная склейка, страницы и стражи** — собрать middleware приложения (аналог `src/hooks.server.ts`), перенести `src/core/server/*` и маршруты `src/routes/**`, адаптировать сборочные правила `tooling/layer-guard.mjs` и `tooling/core-purity.mjs` под расширения файлов нового фреймворка (`.tsx` / `.vue`).
