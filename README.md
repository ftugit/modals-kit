# modals-kit

Демонстрационное приложение SvelteKit с библиотеками:

- **modals** — модальная система с адресуемыми стопками (API — таблица ниже).
- **form** — изоморфные формы: описание данными, разметка приложением, один код
  проверки в браузере и на сервере. Документация и рецепты —
  [`src/lib/form/README.md`](./src/lib/form/README.md).
- **paginate** — headless-библиотека пагинации с разделением framework-neutral ядра и
  адаптеров для SolidJS и Svelte 5 (списки, колонки, бесконечный скролл, сохранение скролла
  при prepend, URL/localStorage/cursor хранилища). Документация —
  [`src/lib/paginate/README.md`](./src/lib/paginate/README.md).

## API модалок

| API | Вид | Описание |
|---|---|---|
| `ModalBox`, `ModalSize`, `MobileAnchor` | типы | Описывают размеры модалки и четыре допустимых мобильных якоря. |
| `ChainOverrides`, `StackMode` | типы | Задают overrides записи и режим изменения существующей стопки при открытии. |
| `RegisteredEntry`, `TransientEntry`, `ChainEntry`, `Chain` | типы | Представляют сериализуемые, временные и составные записи стопки. |
| `entryLabel()` | функция | Возвращает имя зарегистрированной записи или id временной записи. |
| `isRegistered()`, `isTransient()` | функции-предикаты | Сужают тип записи цепочки до зарегистрированной или временной. |
| `ModalContext`, `ModalDefinition` | типы | Описывают контекст содержимого и определение зарегистрированной модалки. |
| `RuntimeStatus`, `RuntimeState` | типы | Описывают статус и результат загрузки одной записи. |
| `OpenAnimation`, `CloseAnimation`, `StackAnimation`, `TailDirection`, `BackdropClick` | типы | Ограничивают варианты анимации, хвостов и обработки клика по фону. |
| `HostConfig`, `DEFAULT_HOST_CONFIG`, `ResolvedEntry` | типы и константа | Описывают настройки хоста, их исходные значения и итоговые параметры записи. |
| `RESERVED_KEYS`, `CHAIN_KEY` | константы | Называют query-параметры, занятые сериализацией стопки. |
| `decodeScalar()`, `encodeScalar()` | функции | Декодируют и кодируют одно scalar-значение query-параметра. |
| `isFlattenable()` | функция-предикат | Проверяет, можно ли развернуть значение параметра в query-строку. |
| `decodeSize()`, `encodeSize()` | функции | Декодируют и кодируют размер модалки для адресной записи. |
| `decodeChain()`, `encodeChain()`, `chainToSearch()` | функции | Преобразуют зарегистрированную часть цепочки между query-строкой и записями. |
| `resolveEntry()` | функция | Сливает запись с её определением и возвращает параметры, используемые видом. |
| `tailScaleAt()`, `visibleTails()`, `resolveTailDirection()`, `tailOffset()` | функции | Вычисляют масштаб, набор, направление и сдвиг хвостов стопки. |
| `visibleChain()` | функция | Убирает из цепочки headless-записи без собственного визуального слоя. |
| `isChainLocked()`, `hasLockedEntry()` | функции-предикаты | Проверяют, запрещает ли lock закрытие верхней записи или всей стопки. |
| `runtimeKey()`, `loaderKey()` | функции | Создают устойчивые ключи состояния записи и кэша загрузчика. |
| `sameEntry()`, `chainEquals()`, `closedSuffix()` | функции | Сравнивают записи и цепочки и определяют закрытый суффикс перехода. |
| `nextChain()` | функция | Строит следующую цепочку с учётом обычного, `new` или `first` открытия. |
| `routeHref()` | функция | Строит адрес полноэкранного маршрута модалки по строке или фабрике route. |
| `mobileAnchorOf()` | функция | Разрешает мобильный якорь из явного override, активной записи и defaultMobile хоста. |
| `viewportStyle()`, `radiusFor()`, `shellBox()`, `shellStyle()`, `tailStyle()` | функции | Возвращают CSS-геометрию сцены, оболочки и хвостов. |
| `createModalStore()`, `ModalStore`, `ModalStoreData`, `StoreListener` | фабрика и типы | Создают независимое хранилище состояния модальной системы и описывают его контракт. |
| `getClientStore()`, `resetClientStore()` | функции | Возвращают или сбрасывают единый browser-store текущего приложения. |
| `createRegistry()`, `ModalRegistry`, `AnyDefinition`, `ResolveHit` | фабрика и типы | Создают область видимости определений и описывают результаты разрешения имён. |
| `globalScope`, `registerModal()` | константа и функция | Дают глобальную область и совместимый способ зарегистрировать в ней определение. |
| `explainMissing()` | функция | Формирует диагностическое сообщение о неразрешённом имени модалки. |
| `createModals()`, `Modals`, `ModalsOptions` | фабрика и типы | Создают API действий модальной системы поверх переданного ядра. |
| `OpenOptions`, `HeadlessOptions`, `LayerOptions` | типы | Задают параметры зарегистрированного, headless и разового открытия в API `Modals`. |
| `ReadContext`, `HrefContext`, `WriteOptions` | типы | Передают ядру серверный адрес и параметры записи в историю. |
| `CoreCapabilities`, `PreloadResult`, `ModalCore` | типы | Описывают возможности, предзагрузку и минимальный контракт транспорта цепочки. |
| `canPreload()`, `canLink()` | функции-предикаты | Проверяют способность ядра предзагружать маршрут или формировать адресную ссылку. |
| `assertTransient()`, `assertTransientOnTop()` | функции | Проверяют поддержку временных записей и инвариант их расположения на вершине стопки. |
| `memoryCore()` | фабрика | Создаёт неадресуемое ядро для тестов, SSR и встраивания без браузерной истории. |
| `StorageEnv`, `ChainStorage`, `MinimalStorage` | типы | Описывают окружение и контракт источников зарегистрированной части цепочки. |
| `urlStorage()`, `localStorageChain()`, `memoryStorage()` | фабрики | Создают источники для URL, localStorage и памяти вкладки. |
| `parseStoredChain()` | функция | Безопасно читает сохранённую JSON-цепочку, отбрасывая некорректные записи. |
| `CoreOptions`, `Sources` | типы | Задают lookup и один либо именованный набор источников при сборке ядра. |
| `buildCore()` | фабрика | Собирает reconfigurable ядро из engine и источника либо набора источников. |
| `ChainEngine`, `memoryEngine()` | тип и фабрика | Описывают среду URL и истории и создают её память-реализацию. |
| `ModalHost` | Svelte-компонент | Монтирует контекст, сцену, историю, фокус и визуальную оболочку стопки. |
| `Layers`, `Tails`, `ModalContent` | Svelte-компоненты | Рендерят слои, хвосты и содержимое одной зарегистрированной модалки. |
| `ModalTrigger` | Svelte-компонент | Открывает зарегистрированную модалку и при доступном href работает как ссылка. |
| `useChain()`, `useModalDepth()`, `useModalsOpen()`, `useChainLocked()`, `useHostConfig()` | Svelte-хуки | Возвращают живые read-only представления цепочки, её состояния и конфигурации хоста. |
| `useModal()`, `ModalHandle` | Svelte-хук и тип | Возвращают живой контекст текущего содержимого модалки. |
| `useModalState()`, `ModalStateHandle` | Svelte-хук и тип | Возвращают resolved-запись и runtime-состояние модалки по имени или индексу. |
| `useModalData()`, `useSharedData()` | Svelte-хуки | Открывают локальную ячейку данных записи и общую доску данных модалок. |
| `useLoader()` | Svelte-хук | Возвращает status, data, error и удобные флаги загрузчика текущей модалки. |
| `createReactiveStore()`, `ReactiveModalStore` | фабрика и тип | Превращают чистый ModalStore в реактивное Svelte-представление. |
| `createMediaQuery()`, `createIsNarrow()` | фабрики | Создают реактивные состояния media query и проверки заданного breakpoint. |
| `HostFloatingRect`, `HostFloatingPlacementOptions`, `HostFloatingOptions`, `HostFloatingCloseReason` | типы | Описывают геометрию, размещение, поведение и причины закрытия host-owned floating entry. |
| `HostFlowOptions`, `HostFloatingApi` | тип и API | Описывают потоковую поверхность без собственного мобильного override и методы host-owned floating entry. |
| `ModalsContext`, `setModalsContext()`, `tryUseModals()`, `useModals()` | контекст и функции | Предоставляют, необязательно читают или требуют живой контекст ModalHost. |
| `OverlayContainer`, `setOverlayContainer()`, `useOverlayContainer()` | контекст и функции | Управляют контейнером портала вложенных оверлеев внутри модального слоя. |
| `InstanceValue`, `setInstance()`, `useInstance()` | контекст и функции | Передают и читают идентичность записи, содержимое которой сейчас рендерится. |
