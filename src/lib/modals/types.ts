// Контракты ядра. НИ ОДНОГО импорта фреймворка — это цель, а не случайность:
// в оригинале здесь жили `Component` и `JSX` из solid-js, и через types.ts
// зависимость расползалась по всему ядру (замер в §0ε плана).
//
// Приём тот же, что у lib/paginate: ядро НЕ НАЗЫВАЕТ тип компонента.
// Вид приезжает параметром `V` — для Svelte это `Component`/`Snippet`,
// для Solid был бы `Component`, для тестов сгодится заглушка.

/* ── размеры и мобильный режим ─────────────────────────────────────── */

/** Числовые размеры оболочки модалки в CSS-пикселях. */
export interface ModalBox {
  /** Предпочтительная ширина оболочки. */
  width?: number
  /** Предпочтительная высота оболочки. */
  height?: number
}
export type ModalSize = ModalBox | 'fullpage'
export type MobileAnchor = 'top' | 'bottom' | 'left' | 'right'

/* ── запись цепочки ────────────────────────────────────────────────── */

/** Значения конкретного открытия, которые сильнее значений определения. */
export interface ChainOverrides {
  /** Размер оболочки для этой записи. */
  size?: ModalSize
  /** CSS-цвет поверхности этой записи. */
  color?: string
  /** CSS-цвет хвостов этой записи. */
  tailColor?: string
  /** Явный мобильный якорь или отказ от прижатия независимо от хоста. */
  mobile?: MobileAnchor | 'off'
  /** Запрещает обычное закрытие этой записи. */
  lock?: boolean
  /** Не позволяет браузерному Forward повторно открыть запись. */
  noForward?: boolean
  /**
   * Запись БЕЗ собственного DOM: хост не рисует для неё ни сцену, ни
   * оболочку, ни хвост.
   *
   * Нужна, чтобы дать уже существующему узлу (например host-floating
   * контейнеру select'а) свойства записи цепочки — историю и «Назад»,
   * порядок закрытия, scroll lock — не перенося его в слой модалки.
   * Перенос узла и был причиной перемонтирования: фокус, каретка в
   * поиске и позиция скролла терялись при повороте экрана.
   */
  headless?: boolean
}

/**
 * Что сделать с текущей стопкой при открытии новой записи.
 *
 * Введено по решению владельца (30.09) вместо `fromRoot` оригинала:
 * «дать опции нормальное название и сделать 2 состояния — „в начало
 * стопки“ и „с новой стопкой“; с этой опцией должно переделываться
 * и href». Журнал отклонений §6 №9.
 *
 *  - `'new'` — «с новой стопкой»: текущая сбрасывается, новая запись
 *    станет единственной. Так работал href прежнего `fromRoot`;
 *  - `'first'` — «в начало стопки»: стопка закрывается до самой первой
 *    модалки, новая запись открывается поверх неё.
 *
 * `undefined` — обычное поведение: запись дополняет текущую стопку.
 */
export type StackMode = 'new' | 'first'

/**
 * Сериализуемая запись: модалка объявлена в реестре, открывается по имени,
 * содержимое рисует JS, живёт в адресе, переживает F5 и передаётся ссылкой.
 */
export interface RegisteredEntry {
  /** Дискриминатор сериализуемой записи. */
  kind: 'registered'
  /** Имя определения в реестре. */
  name: string
  /** Параметры, переданные определению и его содержимому. */
  params: Record<string, unknown>
  /** Overrides конкретного открытия. */
  overrides: ChainOverrides
  /**
   * Имя источника, в котором лежит эта запись.
   *
   * Не сериализуется: проставляется при чтении — тем источником, который
   * запись отдал. При записи выбирается по `ModalDefinition.source`,
   * иначе берётся источник по умолчанию (первый в списке).
   */
  source?: string
}

/**
 * Запись, созданная из кода: содержимое живёт в памяти, в адрес не попадает.
 * Своя запись истории есть (Назад/Вперёд работают), перезагрузку не переживает.
 *
 * ⚠️ Только на вершине стопки — следствие позиционного кодирования адреса
 * (`modal.0.id`): несериализуемая запись в середине сдвинула бы индексы правее.
 */
export interface TransientEntry {
  /** Дискриминатор временной записи. */
  kind: 'transient'
  /** Стабильный идентификатор: ключ в карте содержимого и в истории. */
  id: string
  /** Overrides разового слоя. */
  overrides: ChainOverrides
}

export type ChainEntry = RegisteredEntry | TransientEntry
export type Chain = ChainEntry[]

/** Ярлык записи для ключей и сообщений: имя или id. */
export const entryLabel = (e: ChainEntry): string =>
  e.kind === 'registered' ? e.name : e.id

/** Сужает запись цепочки до зарегистрированной. */
export const isRegistered = (e: ChainEntry): e is RegisteredEntry => e.kind === 'registered'
/** Сужает запись цепочки до временной. */
export const isTransient = (e: ChainEntry): e is TransientEntry => e.kind === 'transient'

/* ── контекст содержимого ──────────────────────────────────────────── */

export interface ModalContext<P = Record<string, unknown>> {
  /** имя из реестра */
  name: string
  /** позиция в стопке: 0 — нижняя */
  index: number
  /**
   * Сколько всего записей в стопке.
   *
   * Сюда входит и системный оверлей (`overrides.headless`) — запись без
   * собственного DOM, которой хост делает модальным чужой узел (мобильный
   * лист `select`). Если нужны только настоящие модалки, фильтруйте
   * цепочку через `visibleChain()`, а не вычитайте единицу.
   */
  depth: number
  /** Параметры этой записи с типом, заданным определением. */
  params: P
  /** Текущая полная цепочка, включая системные записи. */
  chain: Chain
  /** данные, которыми модалки обмениваются */
  data: Record<string, unknown>
}

/* ── регистратор ───────────────────────────────────────────────────── */

/**
 * @template P параметры записи
 * @template D данные загрузчика
 * @template V тип вида фреймворка (Component, Snippet, …) — ядро его не знает
 */
export interface ModalDefinition<
  P extends Record<string, unknown> = Record<string, unknown>,
  D = unknown,
  V = unknown,
> {
  /** Уникальное имя, по которому определение открывается и разрешается. */
  name: string
  /** содержимое; ядру это непрозрачное значение, разворачивает его слой вида */
  component: V
  /** необязательный загрузчик; работает только когда модалка активна */
  loader?: (params: P, signal: AbortSignal) => Promise<D>

  /** Размер по умолчанию для всех открытий этой модалки. */
  size?: ModalSize
  /** Цвет поверхности по умолчанию. */
  color?: string
  /** Цвет хвостов по умолчанию. */
  tailColor?: string
  /** undefined → мобильного режима нет */
  mobile?: MobileAnchor
  /** true → закрыть можно только принудительно */
  lock?: boolean
  /** true → «Вперёд» в браузере не открывает эту модалку заново */
  noForward?: boolean

  /** значения по умолчанию: совпало — в адрес не пишем */
  defaultParams?: Partial<P>

  /**
   * За каким источником закреплена модалка — то есть КУДА её класть.
   *
   * Строка — этот источник. Массив — список допустимых, запись идёт
   * в первый доступный. Не задано — источник по умолчанию (первый).
   *
   * Это размещение, а не разрешение: запись, найденная в другом
   * источнике, всё равно будет показана. Иначе явный
   * `open(name, { source })` молча терялся бы.
   */
  source?: string | readonly string[]

  /**
   * Полноэкранная страница с тем же содержимым: без JS триггер ведёт на неё.
   * Строка с `$param` (`'/films/$id'`) или функция от params.
   *
   * Транспорт, умеющий `preload()`, может взять данные страницы отсюда —
   * тогда собственный `loader` не нужен (см. adapter.ts).
   */
  route?: string | ((params: P) => string)

  /** Вызывается, когда запись этой модалки появляется в цепочке. */
  onOpen?: (ctx: ModalContext<P>) => void
  /** Вызывается, когда запись этой модалки удаляется из цепочки. */
  onClose?: (ctx: ModalContext<P>) => void
}

/* ── состояние выполнения одной записи ─────────────────────────────── */

/** Допустимые фазы асинхронной загрузки содержимого. */
export type RuntimeStatus = 'idle' | 'loading' | 'ready' | 'error'

/** Наблюдаемое состояние загрузчика одной resolved-записи. */
export interface RuntimeState<D = unknown> {
  /** Текущая фаза загрузки. */
  status: RuntimeStatus
  /** Результат успешно завершившегося загрузчика. */
  data?: D
  /** Человеко-читаемая ошибка неуспешного загрузчика. */
  error?: string
}

/* ── настройки хоста ───────────────────────────────────────────────── */

export type OpenAnimation = 'fade' | 'scale' | 'slide-up' | 'none'
export type CloseAnimation = 'fade' | 'scale' | 'slide-down' | 'none'
export type StackAnimation = 'cards' | 'deck' | 'fan' | 'none'
export type TailDirection = 'top' | 'bottom' | 'left' | 'right' | 'none'
export type BackdropClick = 'top' | 'all' | 'none'

/**
 * @template V тип вида фреймворка — им типизированы слоты оформления.
 *
 * ⚠️ Вынужденная правка контракта №2 (§2 плана): в оригинале слоты были
 * `() => JSX.Element`. Здесь это `V`, а в слое Svelte — `Snippet`.
 */
export interface HostConfig<V = unknown> {
  /** Показывать ли control закрытия в оболочке. */
  closeIcon: boolean
  /** Каким слоям разрешён клик по фону. */
  backdropClick: BackdropClick
  /** Максимальное число видимых хвостов за активной записью. */
  tailCount: number
  /** Сторона, в которую уходят хвосты. */
  tailDirection: TailDirection
  /** масштаб хвоста на каждый уровень глубины */
  tailScale: number
  /** Анимация появления сцены. */
  openAnimation: OpenAnimation
  /** Анимация исчезновения сцены. */
  closeAnimation: CloseAnimation
  /** Анимация укладки неактивных записей. */
  stackAnimation: StackAnimation
  /** ширина, ниже которой включается мобильный режим */
  mobileBreakpoint: number
  /** потолок высоты центрированной модалки, CSS-строка */
  maxHeight?: string
  /**
   * Прижатие ПО УМОЛЧАНИЮ — для записей, которые о себе ничего не сказали.
   *
   * `'off'` — «по умолчанию не прижимать». Это именно умолчание, а не
   * выключатель функции: модалка с собственным `mobile` прижмётся всё
   * равно. Отдельное значение нужно потому, что `configure()` намеренно
   * игнорирует `undefined` — это «не менять», поэтому пустым значением
   * умолчание не выключить.
   */
  defaultMobile?: MobileAnchor | 'off'

  /**
   * Умолчание мобильного режима для ОБЫЧНЫХ host-owned popup/menu.
   *
   * Не задано — popup/menu следует общему `defaultMobile`; `false` оставляет
   * его выпадашкой. Поверхности потока (Select) эту настройку не читают:
   * хост всегда делает их частью цепочки на узком экране. Обычный оверлей
   * со своим `modalOnNarrow` может переопределить умолчание.
   */
  floatingMobile?: boolean
  /** очищать память после закрытия последней модалки */
  clearOnClose: boolean

  /** Вид, показываемый пока активная модалка загружается. */
  renderSkeleton?: V
  /** Вид, показываемый при ошибке загрузки активной модалки. */
  renderError?: V
  /** Пользовательский вид control закрытия. */
  renderCloseIcon?: V

  /** только для первой модалки в стопке; вложенные не триггерят */
  onHostOpen?: (ctx: ModalContext) => void
  /** Вызывается после закрытия последней записи стопки. */
  onHostClose?: () => void
  /** на каждую новую модалку */
  onModalOpen?: (ctx: ModalContext) => void
  /** Вызывается при разрешённом клике по фону сцены. */
  onBackdrop?: (action: BackdropClick) => void
}

export const DEFAULT_HOST_CONFIG: HostConfig = {
  closeIcon: true,
  backdropClick: 'top',
  tailCount: 3,
  tailDirection: 'bottom',
  tailScale: 0.94,
  openAnimation: 'scale',
  closeAnimation: 'scale',
  stackAnimation: 'cards',
  mobileBreakpoint: 768,
  maxHeight: '80vh',
  floatingMobile: true,
  clearOnClose: false,
}

/* ── разрешённая (слитая) конфигурация записи ──────────────────────── */

/** Итог определения и overrides, из которого хост строит одну запись. */
export interface ResolvedEntry<V = unknown> {
  /** Имя зарегистрированной модалки или id временной записи. */
  name: string
  /** Позиция записи в полной цепочке. */
  index: number
  /** Итоговые параметры открытия. */
  params: Record<string, unknown>
  /** Итоговый размер оболочки. */
  size: ModalSize
  /** Итоговый цвет поверхности. */
  color: string
  /** Итоговый цвет хвостов. */
  tailColor: string
  /**
   * Намерение записи, а не итог: `'off'` означает «эта модалка не
   * прижимается», `undefined` — «ничего не сказано, берите умолчание
   * хоста». Свести оба случая к `undefined` нельзя: тогда запись не
   * смогла бы отказаться от умолчания.
   */
  mobile?: MobileAnchor | 'off'
  /** Итоговый запрет обычного закрытия. */
  lock: boolean
  /** Итоговый запрет browser Forward. */
  noForward: boolean
  /** Найдено ли определение записи в текущей области. */
  known: boolean
  /** Исходное определение, когда запись зарегистрирована и известна. */
  definition?: ModalDefinition<any, any, V>
}

/* ───────────────── приёмник ошибок (Q1) ───────────────── */

/**
 * Конверт ошибки — нормализованный ВЫХОД lib (Q1). Структурная копия конвертов
 * соседних lib; `fatal` намеренно решает хост, не модалки.
 */
export interface LibError {
  readonly lib: 'modals'
  readonly code: 'unknown-modal' | 'load-failed' | 'preload-failed' | (string & {})
  readonly cause: unknown
  readonly ctx?: Record<string, unknown>
}

export type ErrorSink = (e: LibError) => void
