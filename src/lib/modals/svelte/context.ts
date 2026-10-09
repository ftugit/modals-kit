// Контексты слоя Svelte: сама система и контейнер вложенных оверлеев.
import { getContext, setContext } from 'svelte'
import type { Modals } from '../create'
import type { Loader } from '../loader'
import type { ModalRegistry } from '../registry'
import type { MobileAnchor } from '../types'
import type { ReactiveModalStore } from './store.svelte'

const MODALS = Symbol('modals')
const CONTAINER = Symbol('modals:container')
const INSTANCE = Symbol('modals:instance')

/** Прямоугольник trigger относительно viewport для размещения floating entry. */
export interface HostFloatingRect {
  /** Левая граница в CSS-пикселях. */
  left: number
  /** Верхняя граница в CSS-пикселях. */
  top: number
  /** Правая граница в CSS-пикселях. */
  right: number
  /** Нижняя граница в CSS-пикселях. */
  bottom: number
  /** Ширина trigger в CSS-пикселях. */
  width: number
  /** Высота trigger в CSS-пикселях. */
  height: number
}

export type HostFloatingCloseReason =
  | 'escape'
  | 'outside-pointer'
  | 'programmatic'
  | 'transfer'
  | 'owner-closed'

export interface HostFloatingPlacementOptions {
  /** Отступ между anchor/trigger и popup в режимах bottom/top. */
  gap?: number
  /** Минимально полезное место на стороне. Меньше — лучше overlay/cover. */
  minSideSpace?: number
  /** Максимальная высота overlay/cover-режима. */
  maxOverlayHeight?: number
  /** Отступ от края viewport. */
  viewportPadding?: number
}

/** Опции открытия или обновления host-owned floating entry. */
export interface HostFloatingOptions {
  /** Геометрия trigger, относительно которого хост размещает entry. */
  rect: HostFloatingRect
  /** Узлы, клик по которым считается «внутри» floating entry. */
  triggers?: Array<HTMLElement | null | undefined>
  /** Связать ширину entry с trigger или оставить её автоматической. */
  listWidth?: 'trigger' | 'auto'
  /** Минимальная ширина entry в CSS-пикселях. */
  minWidth?: number
  /** Максимальная ширина entry в CSS-пикселях. */
  maxWidth?: number
  /** Тонкая настройка алгоритма размещения. */
  placement?: HostFloatingPlacementOptions
  /** Правила автоматического закрытия floating entry. */
  dismiss?: {
    /** Закрывать при pointer event вне trigger и entry. */
    outsidePointer?: boolean
    /** Закрывать по Escape. */
    escape?: boolean
  }
  /**
   * Локальное решение ОБЫЧНОГО popup/menu на узком экране. Не задавайте
   * его потоковому потребителю: Select открывается через `openFlow`, где
   * хост сам создаёт запись цепочки, историю, хвосты и лист.
   *
   * Узел при этом НЕ переносится в слой модалки: behavioural layering
   * меняет поведение, а не DOM-родителя, сохраняя фокус, каретку и скролл.
   */
  modalOnNarrow?: boolean
  /**
   * Доступное имя слоя. Нужно, когда оверлей становится модальным листом
   * и единственным содержимым сцены: `role="dialog"` без имени — дефект
   * доступности, а хост не знает, что внутри (ISSUES.md R-04).
   */
  label?: string
  /** Направление листа на узком экране: единственное исключение для мобилок. */
  mobile?: MobileAnchor
  /** Вызывается один раз после закрытия с фактической причиной. */
  onClose?: (reason: HostFloatingCloseReason) => void
}

/**
 * Опции потоковой поверхности: намеренно БЕЗ `mobile` и `modalOnNarrow`.
 * Её вид и направление определяет ModalHost, а не компонент-потребитель.
 */
export type HostFlowOptions = Omit<HostFloatingOptions, 'mobile' | 'modalOnNarrow'>

export interface HostFloatingApi {
  /** Открыть обычный popup/menu, которым разрешено выбрать свой мобильный режим. */
  open(options: HostFloatingOptions): string
  /**
   * Открыть поверхность, которая всегда принадлежит потоку модалок.
   *
   * На узком экране хост добавит headless-запись, хвосты, историю и
   * модальность; направление берётся у активной модалки либо у настроек
   * хоста. Это отдельный метод, а не флаг в опциях Select: примитив не
   * может сам отменить правила потока.
   */
  openFlow(options: HostFlowOptions): string
  /** Обновить геометрию открытого floating при scroll/resize/изменении trigger. */
  update(id: string, options: HostFloatingOptions): void
  /** Закрыть и размонтировать floating-контейнер. */
  close(id: string, reason?: HostFloatingCloseReason): void
  /** DOM-узел контейнера, в который портируется меню/listbox/popover. */
  container(id: string): HTMLElement | undefined
}

export interface ModalsContext {
  /**
   * 🔴 Живые геттеры, а не снимок. Хост переживает смену ядра (этап B:
   * ядро пересобирается при смене источников), и контекст отдаёт ТЕКУЩИЕ
   * ядро/зеркало/scope/загрузчик на каждое чтение. Деструктурировать
   * контекст нельзя — значение кассируется и застывает на старом ядре;
   * держите объект: `const m = useModals()`, обращайтесь `m.view.chain`.
   */
  modals: Modals<unknown>
  view: ReactiveModalStore
  /** Область видимости имён: хост по ней разрешает записи цепочки. */
  scope: ModalRegistry
  /**
   * ОДИН загрузчик на систему.
   *
   * Кеш живёт внутри экземпляра, поэтому второй `createLoader` завёл бы
   * второй кеш: триггер предзагружал в свой, хост потом грузил заново
   * и показывал скелетон вместо готовых данных. Поймано прогоном.
   */
  loader: Loader
  /**
   * Позиционированные floating entries, принадлежащие хосту.
   *
   * Это НЕ записи цепочки: у них нет хвостов, адреса и «глубины». Но они
   * рендерятся порталом хоста и попадают в persistentElements диалога,
   * поэтому меню/listbox внутри модалки не считается кликом/фокусом снаружи.
   */
  floating: HostFloatingApi
}

/** Публикует живой ModalHost-контекст для потомков текущего компонента. */
export function setModalsContext(value: ModalsContext): void {
  setContext(MODALS, value)
}

/**
 * Контекст, если он есть. Нужен примитивам, которые работают и внутри
 * модалки, и на обычной странице: `select` просит слой у хоста только
 * тогда, когда хост вообще смонтирован.
 */
export function tryUseModals(): ModalsContext | null {
  return getContext<ModalsContext | undefined>(MODALS) ?? null
}

/** Возвращает обязательный ModalHost-контекст или объясняет ошибку его отсутствия. */
export function useModals(): ModalsContext {
  const ctx = getContext<ModalsContext | undefined>(MODALS)
  if (!ctx) {
    throw new Error(
      '[modals] Контекст не найден: смонтируйте <ModalHost {modals}> выше по дереву.',
    )
  }
  return ctx
}

/* ── контейнер вложенных оверлеев ──────────────────────────────────── */

/**
 * Куда портировать оверлей, открытый ИЗНУТРИ модального слоя.
 *
 * Зачем (комментарий оригинала, `lib/overlay/container.ts`): слой держит
 * ловушку фокуса и dismissable на своём узле content. Всё, что в DOM вне
 * него, для слоя «снаружи»: combobox, портированный в `document.body`,
 * уводит фокус наружу, ловушка возвращает его обратно, начинается
 * focus-пинг-понг, и слой закрывается как от клика по фону.
 *
 * Поэтому контейнер — сцена (`.modal-stage`), а не оболочка:
 * у `.modal-popup` стоит `overflow: hidden`, и он обрезал бы потомков.
 *
 * Вне модалки контейнера нет → `undefined` → портал уходит в `document.body`,
 * то есть поведение по умолчанию не меняется.
 */
export interface OverlayContainer {
  readonly node: HTMLElement | undefined
}

/** Публикует контейнер, в который потомки портируют вложенные оверлеи. */
export function setOverlayContainer(value: OverlayContainer): void {
  setContext(CONTAINER, value)
}

const NO_CONTAINER: OverlayContainer = { node: undefined }

export function useOverlayContainer(): OverlayContainer {
  return getContext<OverlayContainer | undefined>(CONTAINER) ?? NO_CONTAINER
}

/* ── какая запись рендерится прямо сейчас ──────────────────────────── */

/** Идентичность записи, для которой прямо сейчас рендерится содержимое. */
export interface InstanceValue {
  /** Имя зарегистрированной записи. */
  name: string
  /** Её позиция в полной цепочке. */
  index: number
}

/** Публикует идентичность рендеримой записи для её дочерних компонентов. */
export function setInstance(value: InstanceValue): void {
  setContext(INSTANCE, value)
}

/** null — код вызван вне содержимого модалки. */
export function useInstance(): InstanceValue | null {
  return getContext<InstanceValue | undefined>(INSTANCE) ?? null
}
