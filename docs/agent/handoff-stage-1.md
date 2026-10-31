# Передача: этап 1 — живые экраны до закрытия цепочки

Документ для агента без доступа к переписке. Продолжать ровно с «Следующего шага».

## Задача

План `docs/plan-ui-surface-servers-modals-2026-10-31.md` (ветка `img`).
Этап 1 согласован в §3.4: данные, DOM и скролл записи живут, пока запись
где угодно в цепочке (включая «Назад» и свёрнутую панель); при полном
закрытии ключ забывается, поэтому повторное открытие грузит заново.

Принятое ограничение: `forceClose(name)` посреди цепочки сдвигает индексы,
а ключи записей снимаются на монтировании — после такого закрытия живые
соседи могут получить чужие ключи. Документируется, не правится.

## PROCEDURE (пять жёстких правил)

1. Никакой правки без версионного контроля. Репозиторий есть.
2. Коммит нужен, когда изменены файлы вне `/tmp` и хотя бы один гейт зелёный.
   Сообщение — conventional commit, через `/home/node/workspaces/.tools/git-commit.sh`
   после `git add` (без `git add` скрипт падает с кодом 1).
3. Слова «готово/работает/исправлено» без блока доказательств запрещены.
4. Невыполнимое требование называется вслух.
5. После замечания пользователя — стоп, ответ, ожидание решения.

Дополнительно: перед правкой более трёх файлов `git status --porcelain` должен
быть пуст (иначе `wip:` снимок); не пушить `main`/`master`, без force-push.
README трогается в том же коммите, если меняется контракт/API/опции/бюджеты,
иначе в отчёт строка `README <путь>: проверен, правок нет`.

## Состояние репозитория и среды

- Рабочая копия: `/home/node/workspaces/modals-kit`, ветка `img`.
- HEAD на момент передачи: `7a6ca62`, дерево чистое.
- Песочница `workspace-write`; Serena требует `HOME=/home/node/workspaces/.tools/serena-home`.
- Стек: Svelte 5 (руны, снippets вместо слотов), SvelteKit, TS, UnoCSS,
  PGlite/PostgreSQL, Ark UI, CVA `variants`, vitest + Playwright.
- `tooling/{layer-guard,core-purity,public-api}.mjs` держат 5 слоёв:
  `#lib` → `#hooks` → `#components` → `#content` → `#server`.

## Найденные факты (важные)

- `close()` в `src/lib/modals/create.ts:504` только усекает цепочку;
  `clearMemory` при закрытии не вызывается; runtime чистится лишь
  аргумент-less `clearMemory()`. Поэтому LRU-кеш загрузчика переживает
  закрытие и повторное открытие переиспользует тот же `ck` — тезис
  «переоткрытие грузит заново» сегодня сломан.
- `releaseLayers` (`create.ts:249`) откладывает освобождение до конца
  анимации: содержимое выхода и «Вперёд» читают освобождённое. Синхронно
  чистить кеш безопасно — `ModalContent` рисует из `rt`, не из кеша.
- `commit` (`create.ts:199`) — единственная воронка изменений цепочки,
  рядом с `fireLifecycle` и `releaseLayers`.
- `store.registerMemoryCleaner` (`store.ts:108`) — точка подписки;
  `clearLoaderCache(name, params?)` (`loader.ts:372`).
- `component.svelte.ts`: `inflight` — `WeakMap<object, Promise>` (`:39`),
  `resolvedByName` — `$state` (`:42`).
- `viewGate` (`loader.ts:223`) ставит `loading` безусловно, даже когда
  данные уже в кеше.
- Глобальные обходчики стора пагинатора: `filters/FiltersPanel.svelte:122,127,133`,
  `search.svelte.ts:116`, `BlocksFiltersModal.svelte:69-81`,
  `SeedUsersFiltersModal.svelte:56-71`.

## Этапы, критерии проверки

Каждый этап — отдельный локальный коммит после зелёных гейтов
(`lint`, `typecheck`, тесты; `build` один раз перед коммитом).

- **01 (в работе)**: `ensureModalComponent` отдаёт `undefined` для
  неленивых и для уже разрешённых имён; `inflight` → `WeakMap<object, { promise, settled }>`;
  `viewGate` сначала спрашивает `ensureView` и ставит `loading` только когда
  вернулся промис; тип `ensureView` → `Promise<void> | void`;
  `setRuntime` не пишет, если `status`+`data`(+`error`) не изменились.
- **02** (коммитится вместе с 01): `hasData = rt.data !== undefined`;
  `showSkeleton = hasLoader && !hasData && rt.status !== 'error'`;
  ветка ошибки и `wasPending` под `!hasData`; `loading` несёт `prev.data`.
- **03'**: `dropForClosed(prev, next)` рядом с `fireLifecycle`/`releaseLayers`:
  для каждой записи, отсутствующей в `next`, `clearLoaderCache(name, params)`
  и новый `forgetRuntime(key)`. Отдельный коммит.
- **04**: `initial` из `useLoader().data` + `invalidateLoader` в
  `onChange`/`onDone` у `ProfileModal`, `SeedUsersModal`, `BlocksModal` и
  модалок правки/удаления/создания.
- **05**: изоляция пагинатора по ключу записи, снятому на монтировании;
  владелец регистрирует/удаляет стор на mount/unmount; модалки фильтров
  читают через `modal.params`; чистка `extra.ids` переезжает в dispose стора.
- **07**: `error` без данных только на авторитетных 403/404;
  `publicProfile`/`notCreated` → проекция `ProfileRouteData → ProfileRead`.

## Сделано / не сделано

- `7a6ca62` — решения этапа 1 и предложение по этапу 3;
- шаги 01+02 (коммит `5bda344`): `ensureModalComponent` отдаёт `undefined`
  для неленивых и уже разрешённых имён, `inflight` стал
  `WeakMap<object, { promise, settled }>`, `viewGate` спрашивает вид первым
  и ставит `loading` только при реально возвращённом промисе, `setRuntime`
  не пишет без изменений, `loading` несёт `prev.data`, `showSkeleton` и
  ветка ошибки под `!hasData`; два юнит-теста там же — на коде до правки
  оба падают, с правкой зелены; README описывает обе семантики;
- шаг 03' (коммит `93bee9b`): `chainId(e, i)` вынесен общим тождеством места в
  цепочке, `dropForClosed(prev, next)` зовётся из обоих мест, где цепочка
  меняется (`commit` и приём цепочки из истории), и забывает записи, которых
  нет в `next`; `forgetRuntime(name)` в `loader.ts` снимает состояния вида
  (полной заменой `store.set`, потому что `merge` не удаляет ключи);
  юнит-тесты «clearMemory по имени забывает состояние записей вида» и
  «закрытая запись забывает загрузку: повторное открытие перезапрашивает»
  падают на коде до правки и зелены с ней; README описывает новую семантику
  закрытия.
- шаг 04 (этот коммит): носители `ProfileModal`, `SeedUsersModal`,
  `BlocksModal` берут данные из `useLoader().data` и передают их вниз
  (`route`/`initial`), сами данные не запрашивают; все мутирующие модалки
  (`ProfileEdit`, `ProfileDelete`, `BlockCreate`, `BlockEdit`, `BlockDelete`)
  зовут `invalidateLoader(...)` ДО `close()` — слой под ними
  переактивируется сразу после закрытия и иначе получил бы кеш; `Profile.svelte`
  получил проп `route` с приоритетом после `initial` (страница `/user/[id]`
  работает без лишнего запроса), `SeedUsersList`/`BlocksList` — проп `initial`
  с тем же приоритетом. `ProfileDeleteModal` не закрывается (`doneHref` ведёт
  навигацией), поэтому сброс кеша там не привязан к закрытию.

- шаг 05 (коммит `0bed0ae`): `scopes.ts` с `acquireScopedStore` /
  `releaseScopedStore` / `findScopedStore` (область живёт по счётчику ссылок,
  последняя ссылка удаляет состояние вместе с `extra.ids`); списки берут ключ
  записи из `useRuntimeKey()` на монтировании и владеют областью, модалки
  фильтров читают `modal.params.scope` и падают на общий Store, если область
  уже освобождена; `useRuntimeKey()` добавлен в экспорт `#lib/modals/svelte`.
  Гейты: `npm run check` — 0/0, `npm run test:guard` — 151/151,
  `npm run build` — ok. Браузерные наборы шага ещё не прогнаны (см. ниже).

Не сделано: шаг 07 этапа 1, этапы 2-4, push и PR.

### Не закрыто: браузерная проверка шага 05

`vite preview` (и `vite dev`) не выводят `console.log` SSR в свой stdout, поэтому
ключ администратора из `announceSeedAdmin` в лог не попадает и наборы
`blocks.mjs` / `auth.mjs` / `history-state.mjs` без `MODALS_ADMIN_SECRET`
не запускаются. Сервер поднят на `127.0.0.1:5199` с `AUTH_SEAL_SECRET`
(вход включён, форма `/user/auth` отдаётся), сам набор не прогонялся.
Обходной путь без правки кода: зарегистрировать аккаунт через UI
(`/user/auth?stage=auth.register` генерирует seed) и передать его как
`MODALS_ADMIN_SECRET` — страницы под гостем не открываются, но это не админ,
поэтому проверки прав и админ-панели надо смотреть отдельно.
По этапу 3 ждут ответа три развилки (кнопка удаления в `controls` формы;
`reset-key` третьим действием формы; удаление `bindCookieVault` и
`StorageVaultForm.svelte`).

### Зонды (временные, в git не входят)

`test/browser/zz-probe.mjs` (открыть список → Escape → открыть снова:
скелетон только на первом открытии) и `test/browser/zz-probe3.mjs`
(«Фильтры» → «Применить» на открытом списке: скелетона нет, строки
остаются). Оба зелёные и на правке, и на базе — поэтому дельту доказывают
юнит-тесты, а зонды служат смоук-проверкой отсутствия регрессии. Запуск:
`PLAYWRIGHT_BROWSERS_PATH=/home/node/workspaces/.tools/pw-browsers node
test/browser/zz-probe3.mjs <admin-key>` (нужен живой `vite preview` на 5199).

## Следующий шаг

Шаг 05: изоляция пагинатора по ключу записи, снятому на монтировании;
владелец регистрирует/удаляет стор на mount/unmount; модалки фильтров
читают `modal.params`; чистка `extra.ids` переезжает в dispose стора.

Зонд шага 04 — `test/browser/zz-probe4.mjs` (тоже вне git): правка ника
под открытым профилем — ник обновляется без перезагрузки, запрос данных
идёт (кеш сброшен ДО закрытия), полное закрытие и повторное открытие
перезапрашивают данные заново. Зелёный. Заодно зелёные `blocks.mjs`
(шаг 5 набора — живое обновление списка после создания), `auth.mjs` и
`history-state.mjs`.
