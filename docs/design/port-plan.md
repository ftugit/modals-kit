# План переноса на другой фреймворк / роутер

Порядок: **ядра → адаптеры фреймворка → примитивы → фичи → страницы**. Каждый уровень опирается только на предыдущие.

Статус на текущий срез: шаги **2–5** уже доказаны работающей симуляцией на **React 19 + React Router v7** в [`sim/react-router/`](../../sim/react-router/README.md) (те же исходники ядер `src/lib/*`, ноль `svelte` в `node_modules`). Шаги **6–10** описывают перенос прикладной сборки.

---

1. **Тексты UI в `src/lib/`** — перед выделением пакетов или сменой языка интерфейса вынести русские строки из ядер и адаптеров в словари/опции по образцу `src/lib/form/messages.ts`. Текущий перечень мест в `src/lib/`:
   - `src/lib/form/messages.ts`, `src/lib/form/validate.ts` — словарь сообщений валидаторов и склейка списков (`«…» и «…»`); в `svelte/{config.ts,bind.svelte.ts,field-set.svelte.ts}` — диагностика конфигурации/разметки и `'транспорт не настроен'`.
   - `src/lib/modals/loader.ts` — `'Ошибка загрузки'`, `'Нет такой модалки: «…»'`, `'Маршрут …: …'`, `'Отменено'`.
   - `src/lib/modals/{core-contract.ts,registry.ts}` и `src/lib/modals/svelte/{ModalHost.svelte,ModalContent.svelte,state.svelte.ts,context.ts}` — диагностические ошибки областей/слоёв, `'Закрыть модалку'`, `'(i из N)'`.
   - `src/lib/address/keys.ts` — ошибки пересечения и прав реестра ключей адреса; `src/lib/address/sveltekit.ts` — подпись задачи `'Переход'`.
   - `src/lib/task/index.ts` — форматтер подписи `'шаг i из N'`.
   - `src/lib/paginate/{core.ts,source.ts,adapter-url.ts}` и `src/lib/paginate/filters/{schema.ts,params.ts}` — dev-предупреждения и ошибки контракта источника/ключей.

2. **`#lib/address` — адаптер роутера** *(доказано в `sim/react-router/src/address.ts`)*.
   Ядро (`src/lib/address/{core,keys,layer-links}.ts`) чистое. Написать модуль взамен `src/lib/address/sveltekit.ts` + `svelte/watch.svelte.ts`: чтение видимого адреса с подпиской, запись query/state одной очередью, задачи навигации и ссылок (`navigationTask`, `linkTask`).

3. **`#lib/modals` — движок роутера + адаптер компонентного фреймворка** *(доказано в `sim/react-router/src/modals.tsx`)*.
   Ядро чистое, контракт — `ModalCore` (`core-contract.ts`) + `ChainEngine` (`engine.ts`). Написать `cores/<router>.ts` по образцу `cores/sveltekit.ts` / `cores/fastedge.ts`, плюс реактивный хост и хуки взамен `src/lib/modals/svelte/` (`ModalHost`, `Layers`, `ModalContent`, `Tails`, `useModals`, `useModal`, `useModalState`, `useModalLink`).

4. **`#lib/form` — адаптер реактивности и транспорт** *(доказано в `sim/react-router/src/form.tsx`)*.
   Ядро чистое (`FormStore` совместим с `useSyncExternalStore`, `evaluate`/`runSubmit`/`createFormHandler` общие для клиента и сервера). Написать реактивную связку `bind` + компонент `<Form>` по образцу `src/lib/form/svelte/{bind.svelte.ts,Form.svelte,field-set.svelte.ts,task.ts}` (включая `FieldHandle` для `takeover`) и HTTP-транспорт под экшены целевого фреймворка взамен `src/lib/components/form/transport.ts`.

5. **`#lib/paginate` (+ `filters`, `search`) — адаптер и роутер** *(ядро и React-хук доказаны в `sim/react-router/src/paginate.ts`)*.
   Ядро, `search/` и `filters/` чистые. Написать реактивную обвязку взамен `src/lib/paginate/svelte/` (`PaginatorHost`, `PageAnchor`, `EdgeSentinel`, `usePaginator*`, `paginatorTask`, `useSearchCorrection`) и мост к роутеру взамен `src/lib/paginate/sveltekit/router.ts` поверх `#lib/address` из шага 2.

6. **Серверные ядра и связки без UI** — `#lib/db` (`index.ts`, `schema.ts`, `sync/`, `adapters/*`, `ops.ts`), `#lib/cache`, `#lib/fetch`, `#lib/image` (включая `#lib/image/node.js`), `#lib/task` и переходники `src/hooks/{cache-db.ts,db-form.ts}` переносятся как есть. Заменяются только обвязки под `RequestEvent` SvelteKit:
   - `src/lib/db/sveltekit/*` (`dbHandle`, `toKitError`, `parseListInput`, `cursorCodecFromEnv`);
   - `src/hooks/component-form/{server.ts,client.svelte.ts}` — middleware приёма POST встраиваемых форм компонентов по `__form_id` и клиентский хук `bindComponentForm`.

7. **Примитивы UI (`src/lib/components/ui/**`)** — переписать на целевой фреймворк (Ark UI / Zag для React/Solid/Vue + те же CVA/UnoCSS-токены из `unocss.config.ts` и `src/app.css`), в том числе `Attachment` и `FileAttachment`. Сохранить контракт нативных носителей в `<Form>` до гидратации, если требуется работа без JS.

8. **Прикладные обвязки (`src/lib/components/{links,loader,shell,header,sidebar,modals,form,paginator,filters,steps,settings,demo}/`)**:
   - `links/` (`asLink`, `asModalLink`) и `loader/` (`LoaderBar`, `trackTask`) — поверх `#lib/address` и `#lib/task`;
   - `form/` (`Field` с `takeover`/`instead`, `FieldShell`, компоненты видов ввода, `photo.ts`, `extend.ts`);
   - `steps/` (`useSteps`, `Steps`, `StepLink`, `formSteps`, `FormSteps`);
   - `paginator/` и `filters/` (`FiltersPanel`, `ActiveFilters`, `bindFilters`);
   - `shell/`, `header/`, `sidebar/`.

9. **Контент и модуль пользователя (`src/content/**`)** — перенести без правок доменное ядро `src/content/user/{acl,auth,checks,config,error,keys,ports,profile,schema,types,vault}.ts` и источники каталогов (`items.ts`, `posts.ts`, `shikimori*.ts`, `rickmorty*.ts`). Переписать под целевой фреймворк:
   - `src/content/user/gateway.ts` (куки и серверный фасад запроса);
   - `src/content/user/vault.svelte.ts` (реактивное клиентское зеркало `vault`);
   - UI-слой `src/content/user/ui/` (`Acl`, `AuthWidget`, `MenuBody`, `UserMenu`, `BanNotice`, `RestrictionsNotice`, папочные модули `ui/seed-form/` и `ui/profile-form/`).

10. **Серверная склейка, страницы и стражи** — собрать middleware приложения (аналог `src/hooks.server.ts`), перенести `src/lib/server/*` и маршруты `src/routes/**`, адаптировать сборочные правила `tooling/layer-guard.mjs` и `tooling/core-purity.mjs` под расширения файлов нового фреймворка (`.tsx` / `.vue`).
