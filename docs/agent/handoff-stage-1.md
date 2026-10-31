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

Сделано:

- `7a6ca62` — решения этапа 1 и предложение по этапу 3;
- шаги 01+02 (второй коммит): `ensureModalComponent` отдаёт `undefined`
  для неленивых и уже разрешённых имён, `inflight` стал
  `WeakMap<object, { promise, settled }>`, `viewGate` спрашивает вид первым
  и ставит `loading` только при реально возвращённом промисе, `setRuntime`
  не пишет без изменений, `loading` несёт `prev.data`, `showSkeleton` и
  ветка ошибки под `!hasData`;
- два юнит-теста в `loader.test.ts` («повторная загрузка тех же параметров
  не снимает готовые данные», «setRuntime: то же состояние не
  переписывается») — на коде до правки оба падают, с правкой зелены;
- README `src/lib/modals/README.md` описывает обе новые семантики.

Не сделано: шаги 03', 04, 05, 07 этапа 1, этапы 2-4, push и PR.
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

Шаг 03': `dropForClosed(prev, next)` рядом с `fireLifecycle`/`releaseLayers`
в `src/lib/modals/create.ts` — `clearLoaderCache(name, params)` плюс новый
`forgetRuntime(key)` для записей, которых нет в `next`; отдельный коммит.
Без него `close()` только обрезает цепочку и кеш загрузчика переживает
закрытие, поэтому повторное открытие не перезапрашивает данные.
