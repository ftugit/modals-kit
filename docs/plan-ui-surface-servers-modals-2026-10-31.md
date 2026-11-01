# План: универсальный экранный блок `Surface`, единая форма серверов хранилища и устранение перерисовки модалок / сброса пагинатора (2026-10-31)

Статус: **этап 1: шаги 01-06 сделаны, шаг 07 открыт; этап 2 (`Surface`) не начат; решения этапа 4 согласованы (§3.5)** (базовый коммит ветки `img`: `7614c4b`, пакет `demo@1.0.0` в `refs/tags/modules`: `527502b`).

Нумерация этапов — по §5. Заголовок §3.5 раньше называл общую форму «этапом 3»; это была ошибка нумерации, теперь §3.5 — **этап 4**. Проверено 2026-11-01 по git: `git log --all --diff-filter=A -- 'src/components/ui/surface/*'` пуст, то есть `Surface` ещё не создавался ни в одном коммите.

Документ фиксирует запросы владельца, результаты полного аудита кодовой базы, корневые причины найденных проблем, архитектурное решение без костылей и поимённую сводку всех файлов ядра `img` и модуля `demo`, которые предстоит создать или обновить.

---

## 1. Запросы и решения владельца

1. **Профиль и верхняя панель кнопок по образцу шапки сайта (`HeaderRowView`)**:
   - В `Profile.svelte` вынести кнопку `«Редактировать»` из абсолютного позиционирования в отдельную верхнюю строку и перенести туда же `«Блокировки»` и `«Настройки»`, убрав дублирующий нижний подвал с `border-t`.
   - Построить панель действий по той же механике, что и ряд шапки сайта (`src/components/shell/HeaderRowView.svelte`):
     - две позиции кнопок (`start` слева и `end` справа через `ml-auto`);
     - горизонтальная прокрутка внутри стороны при дефиците ширины (`overflow-x-auto whitespace-nowrap [scrollbar-width:none]`);
     - автоматический перенос правой группы на новую строку (`flex-wrap`), когда обе стороны не помещаются в один ряд.
   - Везде, где у компонента уже есть кнопка сверху, свести остальные управляющие кнопки в эту же верхнюю панель.

2. **Переиспользуемый UI-компонент экрана для модалки и роута**:
   - Вместо ручной обвязки `userSurfaceVariants` + заголовков + нижних/верхних рядов в каждом экране создать переиспользуемый UI-компонент в `#components/ui` со свойствами `class`, `variant`, `render`, `title`, `controls`.
   - Один и тот же блок должен без изменений работать и на странице маршрута (`variant="card"`), и внутри модального окна (`variant="plain"` с корректной высотой `min-h-0` и вертикальным скроллом содержимого).

3. **Единый компонент формы и управления серверами хранилища (БД + куки-сейф демо)**:
   - Исправить отсутствие вертикального скролла содержимого при редактировании серверов (`storage.servers`).
   - Объединить UI подключения серверов S3 / WebDAV в настройках приложения (`storage-servers`, сохранение в БД) и в демо-стенде (`storage-vault` / `CookieVault`, сохранение в куках): по бизнес-логике оба сценария делают одну и ту же работу, а сценарные различия (`priority`, редактирование существующего слота по `server_id`, `clear_encryption_key`, статус режима пула, сброс ключа `dv_key`) задаются схемой или опциями одного переиспользуемого компонента.

4. **Устранение повторной загрузки/перерисовки UI модалок и сброса пагинатора без костылей**:
   - Выяснить и штатно устранить причину, по которой любой переход между модалками и возврат «Назад» заново прогоняет загрузку и с нуля перерисовывает UI модалки (даже при наличии данных в кэше), а также сбрасывает накопленные страницы и позицию скролла пагинатора.

---

## 2. Итоги аудита и корневые причины (ход обсуждения)

### 2.1. Аудит компонентов с верхними и разнесёнными кнопками

Проверка всех `.svelte`-компонентов ядра `img` (`src/content/**`, `src/components/**`, `src/routes/**`) и модуля `demo` (`refs/tags/modules:modules/demo/files/**`) выявила две группы экранов.

#### Группа А — кнопки разнесены между верхом и низом экрана
1. `src/content/user/ui/Profile.svelte` — `«Редактировать»` парит через `absolute right-0 top-0 z-10` (а при `notCreated` кнопка `«Заполнить профиль»` лежит внутри тела), тогда как `«Настройки»` и `«Блокировки (N)»` вынесены вниз за `border-t`.
2. `src/content/user/ui/profile-form/ProfileForm.svelte` — вверху справа от заголовка ссылка `«Удалить»` (`user.profile.delete`), внизу под полями `«Сохранить»` и `«Отмена»`.
3. `src/content/user/ui/block-form/BlockForm.svelte` (режим `edit`) — вверху справа от заголовка кнопка `«Удалить»` (`user.blocks.delete`), внизу формы `«Сохранить»` и `«Снять сейчас»` (плюс кнопка `«Профиль»` у поля `ID` пользователя).
4. `src/content/user/ui/UserPicker.svelte` — сверху навигация по шагам `<Steps>` (`Выбор пользователей / Выбранные`), снизу через `border-t` кнопки `«Сбросить выбор»`, `«Отмена»`, `«Применить»`.
5. `src/content/user/ui/user-config/UserConfig.svelte` + `UserConfigFields.svelte` — сверху переключатель разделов `<Steps>` (и локальные `«Сбросить»` внутри карточек переопределённых ключей), снизу `«Сохранить»` и `«Отмена»`.
6. `src/content/storage-servers/ui/StorageServersView.svelte` — в шапке редактора кнопка `«Новый слот»` (и в карточках серверов `«Изменить»` / `«Удалить»`), внизу формы `«Проверить и добавить»` / `«Проверить и обновить»` и `«Закрыть»`.
7. В модуле `demo`:
   - `modules/demo/files/src/routes/(site)/(modals-demo)/CardModal.svelte` — сверху кнопка `✕` (`Закрыть текущую`), снизу в подвале через `border-t` триггеры дочерних модалок и `CloseAllButton`.
   - `modules/demo/files/src/routes/(site)/(modals-demo)/FullpageModal.svelte` — сверху в шапке `«Закрыть»`, внизу контента `«Открыть карточку поверх»` и `CloseAllButton`.

#### Группа Б — кнопки уже наверху, но без единого 2-позиционного `controls` со скроллом и переносом
8. `src/content/user/ui/BlocksList.svelte` — сверху заголовок со счётчиком слева, `«Добавить»` и `«Фильтры»` справа.
9. `src/content/user/ui/SeedUsersList.svelte` — над списком строка `SearchBar` слева и `«Фильтры»` справа.
10. `src/components/demo/CookieVault.svelte` — в шапке заголовок и бейдж статуса ключа слева, `«Сбросить ключ и куки»` и `«← К демо»` справа.
11. `src/content/user/ui/seed-form/SeedForm.svelte` — справа от заголовка `Вход в аккаунт` / `Регистрация` стоит `StepLink` смены шага, под полем — кнопка отправки.

### 2.2. Почему в редактировании сервера (и ряде других модалок) нет скролла содержимого

- Оболочка активного окна `MODAL_POPUP_CLASS` (`src/lib/modals/svelte/classes.ts`) задаёт фиксированную высоту (`height: 620px`, `maxHeight: '80vh'`) и `overflow-hidden`.
- Слои `MODAL_LAYER_CLASS` и `MODAL_CONTENT_CLASS` (`flex min-h-0 flex-auto flex-col h-full`) намеренно не включают `overflow-y-auto`, чтобы экран модалки сам владел своей прокруткой (например, фиксировал шапку с `title` / `controls` и прокручивал только `render`-тело).
- В `StorageServersModal.svelte` (как и в `AuthModal`, `ProfileModal`, `ProfileEditModal`, `ProfileDeleteModal`, `UserConfigModal`, `BlockCreateModal`, `BlockEditModal`, `BlockDeleteModal`, `BlocksFiltersModal`, `SeedUsersFiltersModal`) корневая обёртка написана как `<div class="my-auto w-full p-6">` или `<div class="flex flex-col gap-4 p-6">` без `min-h-0` и без `overflow-y-auto overscroll-contain`. При переполнении по высоте контент молча обрезается `overflow-hidden` у попапа.

### 2.3. Почему переход между модалками и возврат «Назад» заново грузит / перерисовывает UI и сбрасывает пагинатор

Обнаружена точная цепочка из трёх причин:

1. **Принудительный микротаск со сбросом в `status: 'loading'` в `ensureModalComponent` + `viewGate` (`src/lib/modals/svelte/component.svelte.ts`, `src/lib/modals/loader.ts`)**:
   - `<Layers>` держит неактивные слои стопки смонтированными в DOM (`display: none`), а `pinnedKeys()` в `loader.ts` защищает их кэш данных от вытеснения.
   - Однако при возврате со слоя `1` на слой `0` (`[A, B] → [A]`) эффект в `ModalHost.svelte` снова вызывает `loader.runLoader(A)`.
   - Хотя и данные `A` уже в `cache`, и ленивый чанк `A` уже разрешён в `resolvedByName[A]`, функция `ensureModalComponent` всегда возвращала `Promise<void>` (`Promise.resolve()`), а `viewGate` в `loader.ts` безусловно выполнял `setRuntime(key, { status: 'loading' })` до завершения микротаска `.then(...)`.
   - Переход `ready → loading → ready` в `ModalContent.svelte` на один кадр включал `showSkeleton = true`, **полностью уничтожал живой экземпляр `<Component>`**, взводил `wasPending = true` и на следующем микротаске монтировал компонент с нуля с анимацией `MODAL_REVEAL_CLASS`.

2. **Игнорирование предзагруженных данных `useLoader().data` в `ProfileModal`, `SeedUsersModal`, `BlocksModal`**:
   - У `user.profile`, `user.list` и `user.blocks` объявлен `route`, поэтому `asModalLink` и `loader.ts` уже вызывают `preloadData` маршрута до открытия окна и кладут результат в `useLoader().data`.
   - Но эти три модальных носителя (в отличие от `StorageServersModal` и `UserConfigModal`) не передавали `ldr.data` в проп `initial` своих компонентов (`Profile`, `SeedUsersList`, `BlocksList`).
   - В итоге при каждом монтировании (и на открытии, и после размонтирования из п. 1 на возврате «Назад») компоненты стартовали с `data = null`, рисовали внутренний скелетон и в `$effect` повторно вызывали сетевой `preloadData(...)`.

3. **Затирание `PaginatorStore` новым объектом `snapshot` и общая ячейка стора для разных контекстов**:
   - Повторный `preloadData(...)` из п. 2 возвращал новый объект `snapshot` (только с одной страницей). При монтировании `<PaginatorScope>` и `<Paginator>` вызывали `store.hydrate(name, snapshot)`. Поскольку `hydratedFrom.get(name) === snapshot` сравнивает объекты по ссылке (`src/lib/paginate/store.ts`), стор воспринимал это как свежую выдачу и перезаписывал `c.current = snapshot`, стирая накопленные `loadedPages` и скролл.
   - Кроме того, глобальный список `/blocks` и персональные блокировки `user.blocks({ id: uid })` делили одно имя `'user-blocks'` в глобальном `clientStore`, а список `user.list` (`/users`) и модальный пикер `user.picker` — одно имя `'seed-users'`.

---

## 3. Предлагаемая архитектура решения (без костылей)

### 3.1. Универсальный UI-компонент `Surface` (`src/components/ui/surface/`)

Создаётся переиспользуемый компонент первого уровня в `#components/ui` (заменяющий локальный `userSurfaceVariants` из `src/content/user/ui/Acl.svelte`):

```ts
export type SurfaceVariant = 'card' | 'plain'

export interface SurfaceControls {
  start?: Snippet
  end?: Snippet
}

export interface SurfaceProps {
  /** Оформление поверхности: 'card' для страницы роута, 'plain' внутри модалки. */
  variant?: SurfaceVariant
  /** Дополнительные классы корневого блока (через cn). */
  class?: string
  /** Заголовок экрана (строка или Snippet с бейджем/счётчиком/подзаголовком). */
  title?: string | Snippet
  /** Опциональное краткое описание под заголовком. */
  description?: string | Snippet
  /**
   * Верхняя панель управления по механике HeaderRowView:
   *  - передан Snippet — рендерится в правой группе (`end`, с `ml-auto`) либо как единый ряд;
   *  - передан `{ start, end }` — две группы с горизонтальным скроллом
   *    (`overflow-x-auto whitespace-nowrap [scrollbar-width:none]`) и автоматическим
   *    переносом правой группы на новую строку (`flex-wrap`), когда места мало.
   */
  controls?: Snippet | SurfaceControls
  /** Основное содержимое экрана (совместимо и с пропсом `render`, и со стандартным `children`). */
  render?: Snippet
  children?: Snippet
  /** Прокручивать ли тело при ограниченной высоте родителя (по умолчанию включено в plain/modal). */
  scroll?: boolean
  'data-testid'?: string
}
```

Ключевые свойства `Surface`:
- **Совместимость «модалка ↔ роут»**: на роуте (`variant="card"`) рендерит карточку `rounded-xl border border-border bg-card p-6 text-card-foreground shadow-sm`; внутри модалки (`variant="plain"`) — `flex min-h-0 flex-auto flex-col`, где шапка (`title` + `controls`) остаётся зафиксированной сверху (`shrink-0`), а тело (`render` / `children`) получает `min-h-0 flex-auto overflow-y-auto overscroll-contain`. Это автоматически даёт честный вертикальный скролл во всех модалках (включая `storage.servers`, `user.config.edit`, `user.blocks.*`, `user.profile.*`).
- **Верхний ряд кнопок (`SurfaceBar.svelte` / `controls`)**: повторяет геометрию `HeaderRowView.svelte` (`flex w-full flex-wrap items-center gap-x-2 gap-y-1.5`, у каждой стороны `flex min-w-0 items-center gap-1.5 overflow-x-auto whitespace-nowrap [scrollbar-width:none]`, у правой `ml-auto`).

### 3.2. Единый компонент формы и списка серверов хранилища (`StorageServerManager` / `StorageServerForm`)

По принципу слоёв (`layer-guard`: слой 3 `src/components/` не импортирует слой 4 `src/content/`):
1. **Общая схема базовых полей S3 / WebDAV** (`slot`, `url`, `encryption_key`, `storage_mb`, `file_mb`, `allow_split`, `read_only`) и фабрика расширения полей (`createStorageServerFormFields({ withPriority, editableExisting })`) выносятся в общий слой (`src/hooks/storage-server-form/` или `src/components/storage-servers/`), чтобы и `storageServerForm` (БД), и `storageVaultEntryForm` (куки-сейф) собирались из одного определения без расхождения валидации и подписей.
2. **Единый UI-компонент `StorageServersPanel.svelte` + `StorageServerFormFields.svelte`** в `src/components/storage-servers/`:
   - строится поверх нового `Surface` (`title`, `controls`, `variant`, `class`, `render`);
   - принимает унифицированный список слотов и опции сценария:
     - `withPriority?: boolean` (включено для боевого пула БД, выключено для куки-сейфа);
     - `allowEditExisting?: boolean` (в БД — выбор слота `«Изменить»` с `server_id`, `clear_encryption_key` и сохранением прежнего URL при пустом поле; в куки-сейфе — перезапись слота по имени);
     - `canEdit?: boolean` (для ролей `storage.read` без `storage.edit` показывает только список без формы);
     - слоты/действия шапки в `controls` (статус пула / статус ключа `dv_key`, кнопка `«Сбросить ключ и куки»` в демо, `«Новый слот»` при редактировании, `«← К демо»` / `«Закрыть»`).
3. **`StorageServersView.svelte`** (`src/content/storage-servers/ui/`) и **`StorageVaultView.svelte`** (`modules/demo/files/src/content/storage-vault/ui/`) становятся тонкими адаптерами данных (БД + `STORAGE_ACL` vs `CookieVault` + `dv_key`) над этим единым компонентом. Дублирующий `StorageVaultForm.svelte` удаляется или сводится к тонкой прокладке `bindCookieVault`.

### 3.3. Штатное решение перерисовки модалок и сброса пагинатора (0 костылей)

1. **Синхронный путь готовности вида в `#lib/modals`**:
   - В `src/lib/modals/loader.ts` тип хука расширяется до `ensureView?: (definition: AnyDefinition) => Promise<void> | void`.
   - В `src/lib/modals/svelte/component.svelte.ts` добавляется проверка: если `!isLazy(component)` или `definition.name in resolvedByName`, `ensureModalComponent` синхронно возвращает `undefined` (без создания `Promise.resolve()`).
   - В `viewGate` (`src/lib/modals/loader.ts`): если `deps.ensureView?.(definition)` вернул `undefined`, сразу синхронно вызывается `setRuntime(key, hasData ? { status: 'ready', data } : { status: 'ready' })` **без захода в `{ status: 'loading' }`**.
   - В `store.merge('runtime', ...)` (или перед `setRuntime`): если для `key` уже стоит `status === 'ready'` с теми же `data`, лишняя запись не триггерит реактивные подписчики.
   - **Эффект**: возврат «Назад» по стопке модалок (`[A, B] → [A]`) и повторное открытие уже предзагруженной модалки через `asModalLink` происходят за 0 микротасков, без размонтирования `<Component>`, без вспышки скелетона и без повторной анимации `MODAL_REVEAL_CLASS`.

2. **Мягкое обновление (stale-while-revalidate) при `invalidateLoader` под открытой стопкой**:
   - Если дочерняя модалка явно сбросила кэш родительской (`invalidateLoader`, например после сохранения изменений в `ProfileEditModal`), `runLoader` при перезапросе для слоя, у которого в `runtime[key]` уже были готовые `data`, сохраняет предыдущие `data` в `RuntimeState` (`{ status: 'loading', data: prev.data }`), а `ModalContent.svelte` показывает скелетон **только при первой загрузке, когда данных ещё нет** (`const showSkeleton = $derived(hasLoader && rt.status !== 'ready' && rt.status !== 'error' && rt.data === undefined)`).
   - **Эффект**: даже после редактирования в дочерней модалке родительская модалка при возврате не мигает скелетоном, а плавно обновляет изменённые поля на месте.

3. **Передача `useLoader().data` в `initial` и изоляция `PaginatorScope`**:
   - `ProfileModal.svelte`, `SeedUsersModal.svelte` и `BlocksModal.svelte` получают `const ldr = useLoader<...>()` и передают `initial={ldr.data}` в `Profile`, `SeedUsersList` и `BlocksList`.
   - При мутациях в `ProfileEditModal`, `ProfileDeleteModal`, `BlockCreateModal`, `BlockEditModal`, `BlockDeleteModal` добавляется точечный `m.modals.invalidateLoader(...)` для затронутых записей профиля/блокировок.
   - В `BlocksList.svelte` (при заданном `uid` пользователя) и в `UserPicker.svelte` (в модальном режиме) `<PaginatorScope>` получает собственный `store={localStore}` (`createPaginatorStore()`), чтобы персональные блокировки и пикер пользователей не перезатирали глобальные пагинаторы `/blocks` и `/users`.

### 3.4. Принятые решения по этапу 1 (согласовано владельцем, 2026-10-31)

Этап 1 фиксируется в следующем виде; альтернативы (реестр адресов, `offset`/`enabled`, refcount, `captureScroll`, маркер устаревания) отклонены как избыточные.

1. **Время жизни данных — время жизни записи в стопке.** Данные, DOM и `scrollTop` живут, пока запись находится где угодно в цепочке (включая «Назад» и сворачивание панели). При полном закрытии записи ключ выбрасывается, и повторное открытие запрашивает данные заново. Ключи записей (а не адресов) выбраны потому, что адресные ключи переживают реальное закрытие и ломают требование «открыл заново — запросил заново».
2. **Ключ записи — существующий `runtimeKey(name, index)`** (`src/lib/modals/core.ts`), фиксируется при монтировании слоя и дальше не пересчитывается. Известное ограничение (вне рамок этапа): `forceClose(name)` в середине цепочки сдвигает индексы.
3. **Сброс по закрытию — синхронно в `commit`.** Рядом с `fireLifecycle`/`releaseLayers` добавляется `dropForClosed(prev, next)`: для каждой записи, отсутствующей в `next`, вызывается `clearLoaderCache(name, params)` и новый `forgetRuntime(key)`. Немедленный сброс безопасен, потому что `ModalContent` рендерит из `rt`, а не из кэша; защита `releaseLayers` (анимация выхода, «Вперёд») не затрагивается. Покрывает «Назад», закрытие панели, `forceClose`, `closeAll` и синхронизацию с историей. `invalidateLoader` остаётся точечной ревалидацией внутри живой записи.
4. **Скелетон — только при первой загрузке.** `hasData = rt.data !== undefined`; `showSkeleton = hasLoader && !hasData && rt.status !== 'error'`; ветка ошибки и `wasPending` работают только при `!hasData`; `loading` несёт `prev.data`.
5. **`initial` из `useLoader().data` + точечный `invalidateLoader`** в `ProfileModal`, `SeedUsersModal`, `BlocksModal` и в мутациях `ProfileEditModal`, `ProfileDeleteModal`, `BlockCreateModal`, `BlockEditModal`, `BlockDeleteModal`.
6. **Изоляция пагинатора — по хранилищу записи**, без реестра: `createPaginatorStore()` создаётся владельцем (списком) на смонтированном слое, ключ — тот же зафиксированный `runtimeKey`; список регистрирует хранилище и удаляет его при размонтировании, фильтр-модалка получает тот же ключ через `modal.params` и только читает. Очистка `extra.ids` переезжает из `onDestroy` в освобождение хранилища; `scrollTop` остаётся состоянием DOM и в `PaginatorState` не входит.
7. **`error` без данных** ставится только при авторитетном 403/404, а не при любом сбое.
8. **Порядок этапов**: этап 1 полностью до этапа 2. Коммиты: `01+02` вместе, `03'` отдельно, пагинатор отдельно, `publicProfile`/`notCreated` (`ProfileRouteData → ProfileRead` проекция) отдельным коммитом.
9. **Кнопки отправки форм остаются внутри `render`** (вариант 1 из §4): в `controls` поднимаются только навигационные и контекстные действия.

### 3.5. Этап 4: одна общая форма и тонкий куки-сейф (решения согласованы 2026-11-01)

Требование владельца: одна общая форма на оба сценария; куки-сейф не обрастает собственной абстракцией — только обращение к серверу через компонент формы и сохранение результата в куки и RAM, ровно как работает текущая авторизация пользователя (`AuthWidget` → серверный экшен → запечатанная кука + реактивный RAM-снапшот `vault.svelte.ts`).

Факты, на которых строится решение: набор полей у обоих сценариев совпадает (`slot`, `url`, `encryption_key`, `clear_encryption_key`, `storage_mb`, `file_mb`, `allow_split`, `read_only`), отличие одно — `priority` только в пуле БД; серверный экшен куки-сейфа уже возвращает `snapshot`, а клиент держит его в `$state` и перерисовывает список. Значит общим должен стать не только UI, но и определение формы, а «сейф» — остаться транспортом.

1. **Общее определение формы — `src/hooks/storage-server-form/`** (слой 2, доступен и `#content/*`, и `#hooks/cookie-vault`):
   - `fields.ts` — `storageServerFields({ withPriority, allowEditExisting })`, единственный источник подписей, подсказок, значений по умолчанию и валидации полей;
   - `parse.ts` — `parseStorageServerEntry(values)` (определение схемы `s3://` / `webdav://` через `#lib/storage/s3.js` и `#lib/storage/webdav.js`, нормализация слота, диапазоны квот) и `maskStorageServerEntry(entry)`;
   - `form.ts` — `defineStorageServerForm({ id, withPriority })`: `defineForm` с действиями `save`, `delete` (`validate: 'none'`), `reset-key`;
   - README пакета обязателен (правило §4 репозитория).
2. **Один компонент — `src/components/storage-servers/StorageServerForm.svelte`**: `Surface` + `Common` + `Field` по списку полей + кнопка отправки внутри `render` (решение 9 §3.4) + необязательная кнопка удаления из `controls`; пропы `form` (привязанная через `bindComponentForm`), `withPriority`, `submitLabel`, `editId`, `onSaved`. Никаких копий разметки под сценарий.
3. **Куки-сейф сжимается до транспорта**:
   - `defineCookieVault` сохраняет только `scope`, `maxEntries`, `form`, `parse`, `mask`; генерация `deleteForm`/`deleteFormFor`/`resetKeyForm` уходит — действия живут в общей форме;
   - `bind.svelte.ts` удаляется: вызывающий код использует `bindComponentForm` напрямую (как `AuthModal`);
   - `CookieVault.svelte` остаётся списком (маска слота, удаление, кнопка сброса `dv_key`) и рендерит `StorageServerForm` пропом `form`;
   - `registerCookieVaultForms` регистрирует **одну** форму с ветвлением по `intent` — как уже сделан `storage-server.form.server.ts`.
4. **Сервер и RAM не меняются по существу**: `saveVaultEntry` / `removeVaultEntry` / `resetVaultKey` продолжают писать `HttpOnly`-куки, экшен возвращает `snapshot`, клиент кладёт его в `$state` и гидрирует из данных лоадера. Новых клиентских хранилищ у сейфа нет.
5. **Идентификаторы форм разные** (`storage-server-admin`, `storage-server-vault`), определение — общее: реестр `component-form` падает на дубликате `id`, поэтому один `id` на два экшена не годится.
6. **`priority` и `clear_encryption_key`** — только в режиме БД (`withPriority`/`allowEditExisting`); в сейфе `slot` перезаписывается по имени.

---

## 4. Уточнения (закрыты)

1. **Имя универсального компонента в `#components/ui`** — решено: **`Surface`** (`Surface.svelte`, `surfaceVariants`). Владелец подтвердил имя и потребовал, чтобы лево, центр и право шапки скроллились и переносились на новую строку.
2. **Кнопки отправки форм** — решено: **вариант 1**. В `controls` поднимаются навигационные и контекстные действия (`Редактировать`, `Настройки`, `Блокировки`, `Фильтры`, сброс ключа куки-сейфа), submit-кнопки форм остаются под полями, внутри `render`. Для `UserPicker` кнопки `Сбросить выбор / Отмена / Применить` идут в `controls.end` на одну линию с шагами `controls.start`.
3. **Развилки этапа 4** (закрыты 2026-11-01): удаление — по-строчно в списке; `reset-key` — внешней кнопкой через атрибут `form="<id>"`, без `confirm_scope`; `bindCookieVault` и `StorageVaultForm.svelte` удаляются. Подробности и обоснование — §5.4.

---

## 5. Поэтапный порядок реализации

Порядок жёсткий: 2 опирается на 1, 3 и 4 опираются на 2. Один этап — один локальный коммит, начиная только по прямому указанию владельца.

### 5.1. Статус на 2026-11-01

| Этап | Состояние | Коммиты |
| --- | --- | --- |
| 1 — модалки и пагинатор | шаги 01-06 сделаны и проверены; **шаг 07 открыт** (`error` без данных только на авторитетных 403/404, проекции `publicProfile` / `notCreated`) | `5bda344`, `06a38ff`, `1bddb6b`, `0bed0ae`, `1a3bf60` |
| 2 — `Surface`/`SurfaceBar` | **не начат**; каталога `src/components/ui/surface/` нет, экспорта в `src/components/ui/index.ts` нет, в истории git файлов не было | — |
| 3 — `Profile.svelte` и компоненты ядра на `Surface` | не начат | — |
| 4 — единая форма серверов хранилища | решения приняты (§3.5), код не начат | — |

Отдельно: `ADMIN_SEED` (`430f27e`) и брони ключей фильтров (`e62af5d`) — вне плана, сделаны по ходу.

**Отступление от порядка (2026-11-01, указание владельца).** Решение 8 §3.4 требовало закрыть этап 1 полностью до этапа 2. Владелец распорядился иначе: сначала этап 2 (`Surface`/`SurfaceBar`), затем шаг 07 этапа 1. Работы не пересекаются по файлам: шаг 07 живёт в `#lib/modals`, этап 2 — в `#components/ui` и носителях, а этап 2 дополнительно разблокирует этапы 3 и 4. Учтённый риск: `ModalContent.svelte` правится в этапе 2 и затем ещё раз в шаге 07, где меняется только ветка `error`.

### 5.2. Процедура этапа 2 — `Surface`

1. Создать `src/components/ui/surface/Surface.svelte` по §3.1: `surfaceVariants` (`card` / `plain`, CVA через `#components/utils.js`), `title: string | Snippet`, `description`, `controls: Snippet | { start, end }`, `render` / `children`, `scroll`.
   Скроллит **тело**, не страница: шапка `shrink-0`, тело `min-h-0 flex-auto overflow-y-auto overscroll-contain`. Отступ `p-6` — только на корне, чтобы модалка не задваивала padding.
2. Создать `SurfaceBar.svelte` — две группы `start` / `end` с `ml-auto`, `flex flex-wrap`, каждая группа `overflow-x-auto whitespace-nowrap [scrollbar-width:none]`, `border-b border-border` под шапкой. Именно так выполняется требование владельца: лево, центр и право скроллятся независимо и переносятся на новую строку при нехватке места. Когда передан один Snippet, он идёт в `end`.
3. Добавить `src/components/ui/surface/index.ts` и строку экспорта в `src/components/ui/index.ts`; обновить `src/components/ui/README.md` (новый публичный примитив — контракт меняется).
4. Перевести `src/content/user/ui/Acl.svelte`: `userSurfaceVariants` сейчас объявлен в module-скрипте `Acl.svelte` и импортируется снаружи (`StorageServersView.svelte`, §3.1). Заменить на `surfaceVariants` из `#components/ui`, оставив временный реэкспорт типа, пока не переведены потребители, иначе `npm run check` покраснеет.
5. Перевести все 15 носителей `*Modal.svelte` (`src/content/user/ui/`: `Auth`, `BlockCreate`, `BlockDelete`, `BlockEdit`, `Blocks`, `BlocksFilters`, `Menu`, `ProfileDelete`, `ProfileEdit`, `Profile`, `SeedUsers`, `SeedUsersFilters`, `UserConfig`, `UserPicker`; плюс `src/content/storage-servers/ui/StorageServersModal.svelte`) на `variant="plain"` + `Surface`. Проверить, что ни один носитель не держит свой `overflow-y-auto` и не обрезает контент по высоте.
6. Шлюзы: `npm run check` (0 ошибок), `npm run test:guard` (151/151), `npm run build`, плюс браузерная проверка скролла на `test/browser/modals.mjs` при запущенном превью.
7. Коммит `feat(ui): Surface и SurfaceBar с независимым скроллом зон заголовка`.

### 5.3. Процедура этапа 3 — перевод ядра на `Surface`

1. `Profile.svelte`: `«Редактировать»` / `«Заполнить профиль»`, `«Настройки»`, `«Блокировки (N)»` уходят вверх в `controls` (`start` / `end`); нижний блок `border-t` удаляется.
2. Перевести `BlocksList`, `SeedUsersList`, `UserPicker`, `ProfileForm`, `BlockForm`, `UserConfig`, `SeedForm` на `Surface` с `title` / `description` / `controls` / `render`.
3. Кнопки отправки остаются **внутри** `render`, под полями (§3.4, решение 9); в `controls` — только навигационные и контекстные действия.
4. Шлюзы те же плюс браузерные `blocks.mjs` и `auth.mjs`; коммит `feat(user): экраны ядра на Surface`.

### 5.4. Процедура этапа 4 — единая форма серверов хранилища

Решения владельца от 2026-11-01 (развилки §3.5 закрыты):

- **Удаление — по-строчно в списке**, а не в `controls`. `StorageServersView.svelte` уже так работает: `value={`delete:${srv.id}`}` внутри общей `<Form>`, и `bind()` держит единственный `formEl` для живых проверок `recheck`/`syncPins`.
- **`reset-key` — внешней кнопкой через `form="<id>"`**, а не полем внутри формы. `confirm_scope` удаляется: сервер его не читает (`grep` даёт только объявление в `schema.ts` и отрисовку в `CookieVault.svelte`).
- **`bindCookieVault` и `StorageVaultForm.svelte` удаляются**: у `bindCookieVault` ноль вызывающих (только реэкспорт в `index.ts`), `StorageVaultForm.svelte` живёт лишь в теге `modules` и сводится к общему компоненту.

Обоснование выбора `form="id"` вместо третьего действия внутри тела: `change` из внешнего поля **не всплывает до формы** (проверено в Chromium — событие дошло только до `document`), а `bind.svelte.ts` держит живой коммит и зеркало на слушателе формы. Поэтому внешними допустимы только кнопки и предзаполненные hidden, но не поля ввода. У `reset-key` полей ввода нет, так что приём применим.

Шаги:

1. `src/hooks/storage-server-form/`: `fields.ts` (`storageServerFields({ withPriority, allowEditExisting })`), `parse.ts` (`parseStorageServerEntry`, `maskStorageServerEntry`), `form.ts` (`defineStorageServerForm({ id, withPriority })` с действиями `save`, `delete` (`validate: 'none'`), `reset-key` (`validate: 'none'`)), `index.ts`, обязательный `README.md`.
2. `src/components/storage-servers/StorageServerForm.svelte`: `Surface` + `Common` + `Field`, submit внутри `render`, пропы `form`, `withPriority`, `submitLabel`, `editId`, `onSaved`, `formId`.
3. `<Form id={formId}>` — новое: `Form.svelte` уже разворачивает `rest` поверх `formProps`, правок библиотеки не нужно. `formId` уникален на страницу: `storage-server-admin` и `storage-server-vault`.
4. `StorageServersView.svelte` — тонкий адаптер данных над общим компонентом; по-строчные `delete:<id>` сохраняются.
5. Куки-сейф до транспорта: `defineCookieVault` оставляет только `scope`, `maxEntries`, `form`, `parse`, `mask`; `bind.svelte.ts` и `resetKeyForm` удаляются; `CookieVault.svelte` остаётся списком и рендерит `StorageServerForm` пропом `form`; `registerCookieVaultForms` регистрирует одну форму с ветвлением по `intent`.
6. `CookieVault.svelte`: кнопка сброса в шапке — `<Button form={formId} {...bound.intent('reset-key')} task={formTask(bound.state)}>`, без собственного `<Form>` и без `confirm_scope`.
7. Проверка на чистом ядре и с `MODULES=demo`; пересборка `refs/tags/modules` только локально, без отправки в GitHub.
8. Коммит `feat(storage): единая форма серверов хранилища для пула и куки-сейфа`.

---

## 6. Сводка файлов, которые необходимо создать и обновить

### 6.1. Новые файлы (ядро `img`)

| Путь файла | Назначение |
| --- | --- |
| `src/components/ui/surface/Surface.svelte` | Переиспользуемый экранный блок (`class`, `variant: 'card' \| 'plain'`, `title`, `description`, `controls`, `render` / `children`, вертикальный скролл в модалке), совместимый между роутом и модалкой |
| `src/components/ui/surface/SurfaceBar.svelte` | Двухпозиционная панель кнопок (`start` / `end` с `ml-auto`, `flex-wrap`, горизонтальный скролл `overflow-x-auto whitespace-nowrap [scrollbar-width:none]`) по образцу `HeaderRowView` |
| `src/components/ui/surface/index.ts` | Публичные экспорты `Surface`, `SurfaceBar`, `surfaceVariants` и типов |
| `src/components/storage-servers/StorageServersPanel.svelte` | Единый UI-компонент списка слотов и формы подключения S3 / WebDAV поверх `Surface`, настраиваемый схемой/опциями под БД (`storage-servers`) и куки-сейф (`storage-vault`) |
| `src/components/storage-servers/StorageServerFormFields.svelte` | Общая разметка полей подключения S3 / WebDAV (`slot`, `url`, `encryption_key`, `clear_encryption_key`, `storage_mb`, `file_mb`, `priority`, `allow_split`, `read_only`) |
| `src/components/storage-servers/schema.ts` | Общая фабрика полей и базовых правил валидации S3 / WebDAV для обоих сценариев (БД и куки) |
| `src/components/storage-servers/index.ts` | Реэкспорт единого компонента и фабрики схемы серверов хранилища |

### 6.2. Обновляемые файлы ядра `img` — модальная система и загрузка данных

| Путь файла | Что меняется |
| --- | --- |
| `src/lib/modals/loader.ts` | Контракт `ensureView?: (def) => Promise<void> \| void`; синхронный `viewGate` без `status: 'loading'`, когда чанк уже разрешён; сохранение `prev.data` при фоновом ревалидировании после `invalidateLoader` |
| `src/lib/modals/svelte/component.svelte.ts` | Синхронный возврат `undefined` из `ensureModalComponent`, если компонент не `lazy` или уже закэширован в `resolvedByName[definition.name]` |
| `src/lib/modals/svelte/ModalContent.svelte` | Показ скелетона только при отсутствии готовых данных (`rt.data === undefined`), чтобы фоновое обновление кэша не размонтировало живой слой стопки |
| `src/lib/modals/loader.test.ts` | Тесты на синхронный возврат к слою в стопке без перехода в `'loading'` и без повторного монтирования |
| `src/lib/modals/README.md` | Синхронизация описания контракта `ensureView` и поведения стопки при возврате «Назад» |

### 6.3. Обновляемые файлы ядра `img` — UI-компоненты, профиль, списки, формы и модалки

| Путь файла | Что меняется |
| --- | --- |
| `src/components/ui/index.ts` | Экспорт `Surface`, `SurfaceBar`, `surfaceVariants`, `type SurfaceProps`, `type SurfaceVariant` |
| `src/components/demo/CookieVault.svelte` | Перевод оболочки куки-сейфа на `Surface` (`title`, `controls` с `start`/`end` и скроллом тела) |
| `src/content/user/ui/Acl.svelte` | Переход с локального `userSurfaceVariants` на общий `surfaceVariants` / `Surface` (с сохранением реэкспорта типа для обратной совместимости) |
| `src/content/user/ui/Profile.svelte` | Перевод на `Surface`; перенос `«Редактировать»` / `«Заполнить профиль»`, `«Настройки»` и `«Блокировки (N)»` в единую верхнюю панель `controls`; удаление нижнего блока `border-t` |
| `src/content/user/ui/ProfileModal.svelte` | Передача `initial={ldr.data}` из `useLoader()` в `Profile` + корректный скролл-контейнер модалки |
| `src/content/user/ui/ProfileEditModal.svelte` | Скролл-контейнер модалки + `m.modals.invalidateLoader('user.profile', { id: uid })` при сохранении чужого/своего профиля |
| `src/content/user/ui/ProfileDeleteModal.svelte` | Скролл-контейнер модалки + инвалидация `user.profile` / `user.list` после удаления |
| `src/content/user/ui/profile-form/ProfileForm.svelte` | Перевод поверхности и верхней строки с заголовком и действием `«Удалить»` на `Surface` (`title` + `controls`) |
| `src/content/user/ui/profile-delete/ProfileDelete.svelte` | Перевод корневой карточки/поверхности на `Surface` |
| `src/content/user/ui/SeedUsersList.svelte` | Перевод на `Surface` с верхней строкой `controls` (`SearchBar` в `start`, `«Фильтры»` в `end`), учёт `initial` от модального загрузчика |
| `src/content/user/ui/SeedUsersModal.svelte` | Передача `initial={ldr.data}` из `useLoader()` в `SeedUsersList` (устранение двойного `preloadData` и сброса пагинатора) |
| `src/content/user/ui/SeedUsersFiltersModal.svelte` | Приведение раскладки и скролла модалки фильтров к `Surface` |
| `src/content/user/ui/BlocksList.svelte` | Перевод на `Surface` (`title` со счётчиком, `controls` с `«Добавить»` и `«Фильтры»`); изолированный `PaginatorScope` (`createPaginatorStore()`) при открытии с фиксированным `uid` |
| `src/content/user/ui/BlocksModal.svelte` | Передача `initial={ldr.data}` из `useLoader()` в `BlocksList` |
| `src/content/user/ui/BlocksFiltersModal.svelte` | Приведение раскладки и скролла модалки фильтров к `Surface` |
| `src/content/user/ui/BlockCreateModal.svelte` | Скролл-контейнер модалки + инвалидация `user.blocks` / `user.profile` при создании бана |
| `src/content/user/ui/BlockEditModal.svelte` | Скролл-контейнер модалки + инвалидация `user.blocks` / `user.profile` при правке/снятии бана |
| `src/content/user/ui/BlockDeleteModal.svelte` | Скролл-контейнер модалки + инвалидация `user.blocks` / `user.profile` при удалении бана |
| `src/content/user/ui/block-form/BlockForm.svelte` | Перевод на `Surface` (`title` с бейджем статуса + `controls` с `«Удалить»` / действиями) |
| `src/content/user/ui/block-delete/BlockDelete.svelte` | Перевод корневой карточки/поверхности на `Surface` |
| `src/content/user/ui/UserPicker.svelte` | Перевод на `Surface` (`controls.start` — `<Steps>`, `controls.end` — `«Сбросить выбор»` / `«Отмена»` / `«Применить»`); изолированный `PaginatorScope` в модальном режиме, чтобы пикер не затирал `user.list` |
| `src/content/user/ui/UserPickerModal.svelte` | Скролл-контейнер модалки и согласование с `Surface` |
| `src/content/user/ui/user-config/UserConfig.svelte` | Перевод на `Surface` (`title`, `controls` с `<Steps>` разделов) |
| `src/content/user/ui/user-config/UserConfigFields.svelte` | Интеграция с `Surface` без дублирования верхней навигации шагов |
| `src/content/user/ui/UserConfigModal.svelte` | Скролл-контейнер модалки (`min-h-0 flex-auto flex-col`) вместо обрезающего `my-auto` |
| `src/content/user/ui/AuthModal.svelte` | Скролл-контейнер модалки для низких экранов |
| `src/content/user/ui/seed-form/SeedForm.svelte` | Перевод на `Surface` (`title` + `StepLink` в `controls.end`) |
| `src/content/user/README.md` | Актуализация описания `Profile`, `ProfileModal`, `SeedUsersModal`, `BlocksModal` и `Surface` |

### 6.4. Обновляемые файлы ядра `img` — серверы хранилища и маршруты

| Путь файла | Что меняется |
| --- | --- |
| `src/content/storage-servers/form.ts` | Сборка `storageServerForm` на базе общей фабрики полей `src/components/storage-servers/schema.ts` (`withPriority: true`, `editableExisting: true`) |
| `src/content/storage-servers/ui/StorageServersView.svelte` | Перевод на единый `StorageServersPanel` + `Surface` (режим БД с `STORAGE_ACL`, `priority`, редактированием слота и `controls`) |
| `src/content/storage-servers/ui/StorageServersModal.svelte` | Замена нескроллящегося `<div class="my-auto w-full p-6">` на полноценный скроллируемый контейнер модалки (`min-h-0 flex-auto flex-col`) |
| `src/routes/(site)/(app)/user/[id=uuid]/blocks/+page.svelte` | Встраивание кнопки `«← К профилю»` в `controls` поверхности вместо внешней обёртки `mb-3` |
| `src/routes/(site)/(app)/blocks/[blockId=uuid]/+page.svelte` | Встраивание `«← К списку блокировок»` в `controls` поверхности |
| `src/routes/(site)/(app)/blocks/[blockId=uuid]/delete/+page.svelte` | Встраивание `«← К блокировке»` в `controls` поверхности |
| `src/routes/(site)/(app)/user/[id=uuid]/blocks/[blockId=uuid]/+page.svelte` | Встраивание `«← К блокировкам пользователя»` в `controls` поверхности |
| `src/routes/(site)/(app)/user/[id=uuid]/blocks/[blockId=uuid]/delete/+page.svelte` | Встраивание `«← К блокировке»` в `controls` поверхности |
| `src/routes/(site)/(app)/user/[id=uuid]/blocks/new/+page.svelte` | Встраивание `«← К блокировкам пользователя»` в `controls` поверхности |
| `test/browser/auth.mjs` и `test/browser/blocks.mjs` | Проверка новой верхней панели кнопок профиля, скролла модалки серверов, сохранения состояния пагинатора и отсутствия перемонтирования UI при возврате «Назад» |

### 6.5. Обновляемые файлы опционального модуля `demo` (`refs/tags/modules`)

| Путь файла внутри `modules/demo/files/` | Что меняется |
| --- | --- |
| `src/content/storage-vault/schema.ts` | Использование общей фабрики полей S3 / WebDAV из `#components/storage-servers/schema.js` (`withPriority: false`, `editableExisting: false`) |
| `src/content/storage-vault/ui/StorageVaultView.svelte` | Переход на единый `StorageServersPanel` / `StorageServerFormFields` (режим куки-сейфа без дублирования разметки формы) |
| `src/content/storage-vault/ui/StorageVaultForm.svelte` | Тонкая обёртка `bindCookieVault` над общим `StorageServerFormFields` (без собственной копии полей) |
| `src/routes/(site)/(modals-demo)/CardModal.svelte` | При необходимости — сведение верхнего `✕` и действий карточки в общий паттерн `Surface` / `SurfaceBar` |
| `src/routes/(site)/(modals-demo)/FullpageModal.svelte` | При необходимости — сведение верхней кнопки `«Закрыть»` и кнопок открытия поверх в `Surface` / `SurfaceBar` |
