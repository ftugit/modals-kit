<script lang="ts">
  // Хост: один фон на всю стопку и одна оболочка, которая становится хвостом.
  // Порт `host.tsx` оригинала с правками по решениям D8–D11.
  //
  // Один Dialog на N слоёв: машина смонтирована всегда, `open` = «цепочка
  // непуста». Добавление слоя НЕ создаёт второй оверлей — меняется активная
  // запись внутри той же сцены. Отсюда и стопка, и то, что ловушка фокуса,
  // scroll-lock и aria настраиваются ровно один раз.
  //
  // Presence: Ark/Zag снимает элемент по окончании CSS-анимации, а визуал
  // оригинала построен на transition'ах. Поэтому «присутствием» управляет
  // сам хост: на открытии синтезирует `data-starting-style` (первый кадр),
  // на закрытии — `data-ending-style` и снимает содержимое ТОЛЬКО после
  // полного перехода. CSS оригинала работает без изменений (решение D11).
  import { Dialog, useDialog } from '@ark-ui/svelte/dialog'
  import { Portal } from '@ark-ui/svelte/portal'
  import { onMount, untrack, type Snippet } from 'svelte'
  import {
    mobileAnchorOf,
    resolveEntry,
    resolveTailDirection,
    routeHref,
    shellStyle,
    viewportStyle,
    visibleChain,
  } from '../core'
  import { createLoader } from '../loader'
  import type { Modals } from '../create'
  import type { ModalRegistry } from '../registry'
  import { entryLabel } from '../types'
  import type { HostConfig, MobileAnchor, ResolvedEntry } from '../types'
  import {
    setModalsContext, setOverlayContainer,
    type HostFloatingCloseReason, type HostFloatingOptions, type HostFlowOptions,
  } from './context'
  import { createIsNarrow } from './media.svelte'
  import { createReactiveStore } from './store.svelte'
  import {
    floatingLayoutClass,
    MODAL_BACKDROP_CLASS,
    MODAL_CLOSE_ANIMATION_CLASSES,
    MODAL_CLOSE_CLASS,
    MODAL_FLOATING_CLASS,
    MODAL_LAYER_CLASS,
    MODAL_OPEN_ANIMATION_CLASSES,
    MODAL_POPUP_CLASS,
    MODAL_STAGE_CLASS,
    MODAL_VIEWPORT_CLASS,
  } from './classes'
  import Layers from './Layers.svelte'
  import ModalContent from './ModalContent.svelte'
  import Tails from './Tails.svelte'

  /** Публичные props ModalHost; настройки HostConfig применяются как defaults хоста. */
  interface Props extends Partial<HostConfig<Snippet>> {
    /** Экземпляр API, управляющий цепочкой и ядром. */
    modals: Modals<any>
    /** Область, в которой хост разрешает имена записей. */
    scope: ModalRegistry
    /**
     * Содержимое страницы. Хост оборачивает его, потому что контекст
     * в Svelte течёт ВНИЗ по дереву: триггеры и хуки состояния должны
     * быть потомками, иначе `useModals()` их не найдёт.
     * (Поймано SSR-прогоном: хост стоял рядом с триггерами — 500.)
     */
    children?: Snippet
    /** Слоты оформления. lib не содержит оформленных компонентов. */
    skeleton?: Snippet
    error?: Snippet<[string, string | undefined]>
    closeIconSlot?: Snippet
  }
  let { modals, scope, children, skeleton, error, closeIconSlot, ...cfg }: Props = $props()

  /* ── живое «сейчас» хоста ────────────────────────────────────────── */
  // Смена ядра БЕЗ пересоздания хоста (этап B): ядро пересобирается при
  // смене источников, а хост, живущий в корневом layout, обязан это
  // пережить. Поля ниже — единственная точка правды о «текущих» ядре,
  // зеркале, scope и загрузчике; контекст наружу отдаёт их ГЕТТЕРАМИ.
  // Потребители читают по месту употребления (`m.view`, `m.modals`) —
  // деструктуризация кассировала бы значение и застывала на старом ядре.
  //
  // Единственная точка правды о «текущих» ядре, зеркале, scope и загрузчике.
  const initial = untrack(() => ({
    modals,
    scope,
    view: createReactiveStore(modals.store),
    loader: createLoader({
      store: modals.store,
      lookup: scope.lookup,
      preload: undefined,
      hrefOf: (e: any) => routeHref(e.definition?.route, e.params),
    }),
  }))
  let liveModals = $state.raw(initial.modals)
  let liveScope = $state.raw(initial.scope)
  let liveView = $state.raw(initial.view)
  let liveLoader = $state.raw(initial.loader)

  // Зеркало и загрузчик для САМОГО хоста — всегда текущие.
  const view = $derived(liveView)
  const loader = $derived(liveLoader)

  /* ── (пере)подключение ядра ──────────────────────────────────────── */
  // Читает начальную цепочку и подписывается на Назад/Вперёд; чистка
  // эффекта отписывает. Эффект, а не onMount: хост переживает смену
  // ядра (смена источников пересобирает его) и на каждый такой повод
  // переподключается заново. Объявлен ПЕРВЫМ из эффектов — фазовый
  // эффект ниже должен видеть уже подключённое ядро.
  let firstAttach = true
  $effect(() => {
    liveModals = modals
    liveScope = scope
    liveView = createReactiveStore(modals.store)
    liveLoader = createLoader({
      store: modals.store,
      lookup: scope.lookup,
      preload: modals.core.preload
        ? async (href) => {
            const r = await modals.core.preload!(href)
            return r.ok
              ? { ok: true as const, data: r.data }
              : { ok: false as const, reason: r.reason }
          }
        : undefined,
      hrefOf: (e) => routeHref(e.definition?.route, e.params),
    })

    // Подключаем ядро: читаем начальную цепочку и слушаем Назад/Вперёд.
    // Без этого стопка живёт только до первой внешней навигации, а Escape
    // «не закрывает»: шаг назад по истории делается, но никто не слушает.
    const detach = modals.attach()

    // Холодный запуск по ссылке: стопка восстанавливается БЕЗ анимации
    // входа — и только на ПЕРВОМ подключении. Смена ядра при живой
    // цепочке открывается обычной анимацией (почему фаза не ставится
    // отсюда напрямую — см. комментарий у coldStart в фазовом эффекте).
    if (firstAttach && modals.chain.length > 0) coldStart = true
    firstAttach = false
    return detach
  })

  /* ── настройки хоста приходят пропсами и живут в сторе ───────────── */

  $effect(() => {
    modals.configure({
      ...cfg,
      renderSkeleton: skeleton,
      renderError: error,
      renderCloseIcon: closeIconSlot,
    } as Partial<HostConfig<Snippet>>)
  })

  /* ── контекст ────────────────────────────────────────────────────── */
  // Геттеры над живыми полями: потребитель, держащий контекст, видит
  // смену ядра. Деструктурировать контекст нельзя — см. блок «живое
  // сейчас» выше.
  setModalsContext({
    get modals() {
      return liveModals
    },
    get view() {
      return liveView
    },
    get scope() {
      return liveScope
    },
    get loader() {
      return liveLoader
    },
    floating: {
      open: openFloating,
      openFlow: openFlowFloating,
      update: updateFloating,
      close: closeFloating,
      container: floatingContainer,
    },
  })

  // Загрузчик работает ТОЛЬКО для активной записи; модалки в стопке
  // свой загрузчик не запускают. Очистка — на смену активной.
  $effect(() => {
    const a = active
    if (!a) return
    return loader.runLoader(a)
  })

  const config = $derived(view.hostConfig)
  const fullChain = $derived(view.chain)

  /**
   * Видимая часть цепочки: headless-записи исключены.
   *
   * Headless-запись существует ради истории, порядка закрытия и scroll
   * lock'а для УЖЕ существующего узла (host-floating контейнер select'а).
   * Собственного DOM у неё нет, поэтому хост не должен рисовать для неё
   * ни сцену, ни оболочку, ни хвост — иначе поверх списка появлялась бы
   * пустая модалка. Закрытие и Назад работают по полной цепочке.
   */
  const chain = $derived(visibleChain(fullChain))

  /**
   * Основной диалог обслуживает только видимые модалки. Headless-запись не
   * рисует сцену намеренно: её floating-узел получает отдельную Ark-машину
   * `sheetDialog` ниже, которая даёт ему фон, scroll lock и aria-изоляцию.
   * Иначе одинокий Select создавал бы пустую оболочку рядом с собой.
   */
  const open = $derived(chain.length > 0)




  const narrow = createIsNarrow(() => config.mobileBreakpoint)

  const active = $derived<ResolvedEntry | null>(
    chain.length > 0
      ? resolveEntry(chain[chain.length - 1], chain.length - 1, liveScope.lookup)
      : null,
  )

  // Снапшот последней активной записи: показываем её и во время анимации
  // закрытия, иначе оболочка схлопнется в пустоту до конца exit-фазы.
  let lastActive = $state<ResolvedEntry | null>(null)
  $effect(() => {
    if (active) lastActive = active
  })

  const shown = $derived(active ?? lastActive)
  /**
   * Прижатие активной модалки.
   *
   * Порядок: своё намерение записи → намерение ближайшей записи НИЖЕ по
   * стопке → умолчание хоста. Наследование у соседа снизу нужно потому,
   * что модалка, открытая из прижатой справа модалки, обязана выехать
   * оттуда же: иначе стопка распадается на разнонаправленные куски.
   * Запись, сказавшая `'off'`, не прижимается и ничего не наследует.
   */
  const anchor = $derived.by<MobileAnchor | undefined>(() => {
    if (!narrow.matches || !shown) return undefined
    if (shown.mobile) return shown.mobile === 'off' ? undefined : shown.mobile
    for (let i = chain.length - 2; i >= 0; i -= 1) {
      const below = resolveEntry(chain[i], i, liveScope.lookup)
      if (below.mobile) return below.mobile === 'off' ? undefined : below.mobile
    }
    return mobileAnchorOf(shown, narrow.matches, config.defaultMobile)
  })
  const direction = $derived(resolveTailDirection(config.tailDirection, anchor, narrow.matches))
  const locked = $derived(shown?.lock ?? false)
  const fullpage = $derived(shown?.size === 'fullpage')

  /* ── фазы присутствия ────────────────────────────────────────────── */

  type Phase = 'closed' | 'starting' | 'open' | 'ending'
  let phase = $state<Phase>('closed')
  let mounted = $state(false)
  let popupEl = $state<HTMLElement>()
  // null, а не undefined: у части Ark проп `ref` имеет запасное значение,
  // и bind:ref={undefined} падает (`props_invalid_value`).
  let stageEl = $state<HTMLElement | null>(null)
  let closeBtnEl = $state<HTMLButtonElement>()

  /* ── host-owned floating overlays ───────────────────────────── */

  /**
   * `portalTarget` фиксируется в момент открытия: сцена, если модалка
   * открыта, иначе body. Менять его по ходу жизни нельзя — это
   * перемонтировало бы содержимое, ради чего и затевался behavioural
   * layering.
   */
  /**
   * `mode` — решение ХОСТА, не prop потребителя. Обычное меню вправе
   * остаться popup на узком экране; потоковая поверхность (Select) всегда
   * получает headless-запись и правила активной модалки.
   */
  type HostFloating = HostFloatingOptions & {
    id: string
    mode: 'popup' | 'flow'
    portalTarget?: HTMLElement
  }
  type FloatingGeometry = { style: string; place: 'bottom' | 'top' | 'overlay' }
  let floatingSeq = 0
  let floatings = $state<HostFloating[]>([])
  let floatingNodes = $state<Record<string, HTMLElement | null>>({})
  let floatingVersion = $state(0)

  /**
   * Триггер последнего листа — для возврата фокуса.
   *
   * Читать `sheetSurface` в момент возврата поздно: floating снимается
   * раньше, чем ловушка фокуса деактивируется, и точка возврата оказывается
   * пустой — фокус уходил в `body`.
   */
  let lastSheetTrigger: HTMLElement | null = null

  const focusableTrigger = (triggers: HostFloatingOptions['triggers']): HTMLElement | null => {
    const live = (triggers ?? []).filter(Boolean) as HTMLElement[]
    const focusable = [...live]
      .reverse()
      .find((el) => el.matches?.('select, input, button, textarea, [tabindex]'))
    return focusable ?? live[live.length - 1] ?? null
  }

  function openFloatingOfMode(options: HostFloatingOptions, mode: HostFloating['mode']): string {
    const id = `floating-${++floatingSeq}`
    // Триггер запоминаем у ЛЮБОГО оверлея. Для возврата фокуса важен только
    // последний открытый — устаревший отсекает проверка `isConnected`.
    lastSheetTrigger = focusableTrigger(options.triggers) ?? lastSheetTrigger
    // Контейнер остаётся там, где был создан: behavioural layering меняет
    // поведение/оформление, а не DOM-родителя списка.
    floatings = [...floatings, { id, mode, ...options }]
    floatingVersion += 1
    return id
  }

  /** Обычный popup/menu: его явный `modalOnNarrow` допустим. */
  function openFloating(options: HostFloatingOptions): string {
    return openFloatingOfMode(options, 'popup')
  }

  /**
   * Поверхность потока (сейчас Select): на узком экране она ОБЯЗАТЕЛЬНО
   * становится headless-записью стека. Потребитель не передаёт опцию,
   * которая могла бы отменить наследование настроек хоста.
   */
  function openFlowFloating(options: HostFlowOptions): string {
    return openFloatingOfMode(options, 'flow')
  }

  function updateFloating(id: string, options: HostFloatingOptions): void {
    floatings = floatings.map((p) =>
      p.id === id ? { ...p, ...options, id, mode: p.mode } : p,
    )
    floatingVersion += 1
  }

  /**
   * Снять поведение модалки с floating: убрать связь И закрыть саму запись.
   *
   * 🔴 Обе операции обязаны идти вместе. Пока ветка «перестал быть листом»
   * убирала только связь, запись оставалась в цепочке навсегда: серия
   * поворотов копила headless-1…headless-N, «Назад» тратился на невидимую
   * запись, а после R-02 следующая модалка открывалась пустой (ISSUES.md R-01).
   * Запись снимается ПЕРВОЙ, иначе она пережила бы свой контейнер.
   */
  function dropSheetEntry(floatingId: string): void {
    const entryId = sheetEntries[floatingId]
    if (entryId === undefined) return
    const { [floatingId]: _gone, ...rest } = sheetEntries
    sheetEntries = rest
    if (modals.chain.some((e) => entryLabel(e) === entryId)) modals.forceClose(entryId)
  }

  let lastFloatingClosedAt = 0

  function closeFloating(id: string, reason: HostFloatingCloseReason = 'programmatic'): void {
    const floating = floatings.find((p) => p.id === id)
    if (reason === 'outside-pointer') lastFloatingClosedAt = Date.now()
    dropSheetEntry(id)
    floatings = floatings.filter((p) => p.id !== id)
    const { [id]: _removed, ...rest } = floatingNodes
    floatingNodes = rest
    floatingVersion += 1
    floating?.onClose?.(reason)
  }

  /**
   * Behavioural layering: на узком экране floating получает свойства
   * модалки, оставаясь тем же узлом.
   *
   * Это ядро решения. Раньше select на мобильном открывал ОТДЕЛЬНЫЙ
   * transient-слой, то есть содержимое пересоздавалось в другом месте
   * дерева — отсюда потеря фокуса, каретки и скролла при повороте.
   * Теперь переносится не DOM, а поведение: история, «Назад» и блокировка
   * прокрутки приходят к уже смонтированному контейнеру.
   */
  /**
   * Умолчание мобильного режима для оверлеев: своя настройка хоста, а если
   * её нет — общее умолчание `defaultMobile`.
   */
  const floatingMobileDefault = $derived(
    config.floatingMobile ?? config.defaultMobile !== 'off',
  )

  /**
   * Лист ли этот оверлей сейчас.
   *
   * У потоковой поверхности нет локальной «не быть листом» опции: Select
   * создаётся через `openFlow` и на узком экране обязан получить реальный
   * поток модалок. У обычного popup/menu остаётся допустимое исключение —
   * собственный `modalOnNarrow`, иначе он читает настройку хоста.
   */
  const isSheet = (floating: HostFloating): boolean =>
    narrow.matches && (
      floating.mode === 'flow' || (floating.modalOnNarrow ?? floatingMobileDefault)
    )

  /**
   * Направление листа.
   *
   * Своё направление оверлея сильнее всего. Если его нет — наследуем у
   * активной модалки: меню, открытое из прижатой снизу модалки, обязано
   * выезжать оттуда же, иначе лист выглядит чужим. Дальше — умолчание
   * хоста, и только в конце «на весь экран».
   */
  const sheetAnchor = (floating: HostFloating): MobileAnchor | 'fullscreen' =>
    floating.mobile ??
    anchor ??
    (config.defaultMobile && config.defaultMobile !== 'off'
      ? config.defaultMobile
      : 'fullscreen')

  /** id headless-записи цепочки для каждого floating, ставшего листом. */
  let sheetEntries = $state<Record<string, string>>({})

  /**
   * 🔴 Усыновлённый узел САМ становится контентом диалога.
   *
   * `hideContentBelow` помечает `inert` всех соседей `Dialog.Content`
   * (@zag-js/aria-hidden), а контейнер листа лежит в `body` соседом сцены —
   * и становился неинтерактивным. Внутрь сцены его не положить: сцены нет
   * в момент его создания, а поздний перенос — перемонтирование.
   *
   * Машина берёт контент по id (`dialog.dom.mjs: getContentId`), поэтому
   * указываем ей id нашего контейнера и вешаем на него `getContentProps()`.
   * Тогда `inert` достаётся странице, а не списку; ловушка фокуса, scroll
   * lock, aria-isolation и dismissable работают по тому же узлу.
   * Это та же мысль, что и behavioural layering, только на уровне Ark
   * (ISSUES.md R-04).
   */
  /**
   * 🔴 Контент машины — ВЕРХНЯЯ модальная поверхность, что бы под ней ни было.
   *
   * Раньше усыновление включалось только когда видимых записей нет. Если под
   * листом лежала настоящая модалка, контентом оставалась сцена: ловушка
   * держала фокус в сцене целиком, и Tab из листа уходил на контролы фоновой
   * модалки, а сам лист не объявлялся диалогом (ISSUES.md R-15).
   *
   * Теперь правило одно: лист сверху — значит лист и есть контент. Сцена в
   * этом режиме становится обычным фоном и получает изоляцию наравне со
   * страницей, потому что `hideContentBelow` метит соседей контента на всех
   * уровнях — в том числе оболочку модалки внутри самой сцены.
   */
  const sheetSurface = $derived([...floatings].reverse().find((f) => isSheet(f)))
  /**
   * У каждого контейнера стабильный id. Он нужен не только машине листа:
   * по нему триггер внутри модалки объявляет оверлей своим через
   * `aria-controls` — штатный механизм Zag «follow controlled elements»
   * (`@zag-js/dom-query/controller.mjs`), благодаря которому портированный
   * узел считается частью ловушки фокуса.
   */
  const floatingDomId = (id: string) => `modals-host-floating-${id}`
  const surfaceId = $derived(sheetSurface ? floatingDomId(sheetSurface.id) : undefined)



  $effect(() => {
    const wanted = new Set(floatings.filter(isSheet).map((f) => f.id))

    for (const floating of floatings) {
      const has = sheetEntries[floating.id] !== undefined
      if (wanted.has(floating.id) && !has) {
        // Запись БЕЗ собственного DOM: даёт историю и порядок закрытия,
        // но ничего не рисует — рисует уже существующий контейнер.
        //
        // `noForward`: «Вперёд» не воскрешает запись. Floating живёт в
        // памяти компонента-владельца и после «Назад» уже уничтожен —
        // восстанавливать по записи нечего, а без флага в цепочку
        // возвращалось состояние без интерфейса (ISSUES.md R-03).
        const inherited = sheetAnchor(floating)
        const entryId = modals.openHeadless({
          mobile: inherited === 'fullscreen' ? undefined : inherited,
          noForward: true,
        })
        sheetEntries = { ...sheetEntries, [floating.id]: entryId }
      } else if (!wanted.has(floating.id) && has) {
        // Симметрично открытию: снимаем и связь, и саму запись.
        dropSheetEntry(floating.id)
      }
    }
  })

  /**
   * Снятие записи «извне» (кнопка Назад, Escape, backdrop) обязано закрыть
   * и сам floating: иначе список остался бы висеть без своей записи.
   */
  $effect(() => {
    const live = new Set(fullChain.map((e) => entryLabel(e)))
    for (const [floatingId, entryId] of Object.entries(sheetEntries)) {
      if (live.has(entryId)) continue
      const { [floatingId]: _gone, ...rest } = sheetEntries
      sheetEntries = rest
      if (floatings.some((f) => f.id === floatingId)) {
        closeFloating(floatingId, 'escape')
      }
    }
  })

  function floatingContainer(id: string): HTMLElement | undefined {
    void floatingVersion
    return floatingNodes[id] ?? undefined
  }

  function registerFloating(node: HTMLElement, id: string) {
    floatingNodes = { ...floatingNodes, [id]: node }
    floatingVersion += 1

    let ro: ResizeObserver | undefined
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => {
        floatingVersion += 1
      })
      ro.observe(node)
    }

    return {
      destroy() {
        ro?.disconnect()
        const { [id]: _removed, ...rest } = floatingNodes
        floatingNodes = rest
        floatingVersion += 1
      },
    }
  }

  const persistentElements = $derived([
    () => stageEl,
    ...floatings.map((p) => () => floatingNodes[p.id] ?? null),
  ])

  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max))

  function floatingNodeHeight(id: string): number | undefined {
    void floatingVersion
    const node = floatingNodes[id]
    if (!node) return undefined
    const first = node.firstElementChild as HTMLElement | null
    const h = first?.scrollHeight || node.scrollHeight || first?.getBoundingClientRect().height || node.getBoundingClientRect().height
    return Number.isFinite(h) && h > 0 ? h : undefined
  }

  function floatingGeometry(floating: HostFloating): FloatingGeometry {
    if (typeof window === 'undefined') return { place: 'bottom', style: '' }
    // Лист не позиционируется у триггера: раскладку целиком задаёт CSS
    // по data-layout и data-mobile-anchor. JS тут только отдаёт z-index.
    if (isSheet(floating)) {
      return {
        place: 'overlay',
        style: css({ 'z-index': 230 + floatings.findIndex((p) => p.id === floating.id) }),
      }
    }
    const placement = floating.placement ?? {}
    const gap = placement.gap ?? 4
    const margin = placement.viewportPadding ?? 8
    const minSideSpace = placement.minSideSpace ?? 144
    const rect = floating.rect
    const vw = window.innerWidth
    const vh = window.innerHeight
    const minWidth = floating.minWidth ?? rect.width
    const maxWidth = floating.maxWidth ?? Math.min(352, vw - margin * 2)
    const wantedWidth = floating.listWidth === 'auto'
      ? Math.max(minWidth, Math.min(maxWidth, vw - margin * 2))
      : rect.width
    const width = Math.max(0, Math.min(wantedWidth, vw - margin * 2))
    const left = clamp(rect.left, margin, Math.max(margin, vw - width - margin))
    const below = Math.max(0, vh - rect.bottom - gap - margin)
    const above = Math.max(0, rect.top - gap - margin)
    const measuredNeed = floatingNodeHeight(floating.id) ?? minSideSpace
    const need = measuredNeed + gap

    let place: FloatingGeometry['place']
    if (below >= need || (below >= minSideSpace && below >= above)) place = 'bottom'
    else if (above >= need || above >= minSideSpace) place = 'top'
    else place = 'overlay'

    const available = place === 'bottom'
      ? below
      : place === 'top'
        ? above
        : Math.min(placement.maxOverlayHeight ?? 380, vh - margin * 2)
    const height = Math.max(1, Math.min(measuredNeed, available))
    const top = place === 'bottom'
      ? Math.min(vh - margin, rect.bottom + gap)
      : place === 'top'
        ? clamp(rect.top - gap - height, margin, vh - margin - height)
        : clamp(rect.top + rect.height / 2 - height / 2, margin, vh - margin - height)

    return {
      place,
      style: css({
        position: 'fixed',
        left: `${Math.round(left)}px`,
        top: `${Math.round(top)}px`,
        width: `${Math.round(width)}px`,
        'max-height': `${Math.round(Math.max(1, available))}px`,
        '--host-popup-max-height': `${Math.round(Math.max(1, available))}px`,
        '--host-floating-max-height': `${Math.round(Math.max(1, available))}px`,
        '--host-floating-place': place,
        'z-index': 230 + floatings.findIndex((p) => p.id === floating.id),
      }),
    }
  }

  function floatingContains(node: HTMLElement | null | undefined, target: Node | null): boolean {
    return Boolean(node && target && node.contains(target))
  }

  function triggerContains(floating: HostFloating, target: Node | null): boolean {
    return Boolean(target && floating.triggers?.some((trigger) => trigger?.contains(target)))
  }

  function closestFloatingIndex(target: Node | null): number {
    for (let i = floatings.length - 1; i >= 0; i -= 1) {
      const floating = floatings[i]
      if (floatingContains(floatingNodes[floating.id], target) || triggerContains(floating, target)) return i
    }
    return -1
  }

  /**
   * True when the pointer began on the modal shield rather than on the page
   * element the user aimed at. Closing the shield can retarget its trailing
   * click to that page element; a real hit on (for example) «Применить» must
   * instead be allowed to finish its normal click after the popup closes.
   */
  function pointerStartedOnShield(target: Node | null): boolean {
    if (!(target instanceof Element)) return true
    return target === document.documentElement || target === document.body ||
      target.closest('[data-modal-backdrop]') !== null
  }

  $effect(() => {
    if (floatings.length === 0 || typeof document === 'undefined') return

    /**
     * Гашение клика, который остаётся от тапа ПО ФОНУ.
     *
     * 🔴 Закрытие по фону идёт на `pointerdown` (так слой исчезает без
     * задержки), но тот же жест оставляет после себя `click` — а к этому
     * мгновению замок страницы уже снят (`body` снова `pointer-events: auto`),
     * и клик может быть перенаправлен в кнопку ПОД пальцем. Владелец:
     * «нажатием по фону у меня кликались другие кнопки». Гасим его только
     * когда pointerdown начался на щите (HTML/body/backdrop); если он попал
     * прямо в кнопку, её штатный click не подавляем. Слушатель снимает себя
     * сам, а если клика не было — по таймауту.
     */
    const swallowClickOnce = (origin: PointerEvent) => {
      const armedAt = Date.now()
      const x = origin.clientX
      const y = origin.clientY
      const cleanup = () => {
        window.removeEventListener('click', onClick, true)
        window.removeEventListener('pointercancel', cleanup, true)
        window.clearTimeout(timer)
      }
      const onClick = (event: MouseEvent) => {
        cleanup()
        if (Date.now() - armedAt > 700) return // чужой жест — не наш клик
        // «Догоняющий» клик приходит в той же точке, что и нажатие: клик в
        // другом месте — намеренное действие, его не гасим.
        if (Math.abs(event.clientX - x) > 3 || Math.abs(event.clientY - y) > 3) return
        event.preventDefault()
        event.stopPropagation()
      }
      const timer = window.setTimeout(cleanup, 800)
      window.addEventListener('click', onClick, true)
      window.addEventListener('pointercancel', cleanup, true)
    }

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      const keepIndex = closestFloatingIndex(target)
      const toClose = keepIndex < 0 ? floatings : floatings.slice(keepIndex + 1)
      let closed = false
      for (const floating of [...toClose].reverse()) {
        if (floating.dismiss?.outsidePointer === false) continue
        closeFloating(floating.id, 'outside-pointer')
        closed = true
      }
      if (closed && pointerStartedOnShield(target)) swallowClickOnce(event)
    }

    const onKeydown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      const top = [...floatings].reverse().find((floating) => floating.dismiss?.escape !== false)
      if (!top) return
      event.preventDefault()
      event.stopPropagation()
      closeFloating(top.id, 'escape')
    }

    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeydown, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeydown, true)
    }
  })

  const EXIT_TIMEOUT_MS = 500
  const EXIT_EPSILON_MS = 32
  const toMs = (v: string): number => {
    const t = v.trim()
    const n = parseFloat(t)
    if (!Number.isFinite(n)) return 0
    return t.endsWith('ms') ? n : n * 1000
  }

  /**
   * Сколько ждать снятия DOM при закрытии: максимальный (duration+delay)
   * из computed transition попапа. Не по первому `transitionend`: у попапа
   * opacity 200ms кончается раньше width/height 280ms — раннее снятие
   * «отрезало» бы хвост перехода.
   */
  function exitWaitMs(el: HTMLElement | undefined): number {
    if (!el || typeof window === 'undefined') return EXIT_TIMEOUT_MS
    try {
      const cs = window.getComputedStyle(el)
      const dur = cs.transitionDuration.split(',').map(toMs)
      const del = cs.transitionDelay.split(',').map(toMs)
      let max = 0
      const n = Math.max(dur.length, del.length)
      for (let i = 0; i < n; i++) {
        max = Math.max(max, (dur[i % dur.length] ?? 0) + (del[i % del.length] ?? 0))
      }
      // мгновенные переходы (reduced-motion ≈1мс) — без запаса
      return max > 0 ? (max > 16 ? max + EXIT_EPSILON_MS : max) : 0
    } catch {
      return EXIT_TIMEOUT_MS
    }
  }

  let coldStart = false
  onMount(() => {
    // Подключение ядра — в эффекте (пере)подключения выше: он переживает
    // и размонтирование, и смену ядра. Здесь только флаг сцены: до
    // монтирования портал не рендерится (SSR).
    //
    // 🔴 Про холодный старт: phase='open' напрямую НЕ ставится нигде.
    // Машина Ark получает `open` в initialState: созданная сразу с
    // open=true (phase уже 'open' в первом рендере) она остаётся
    // закрытой — перехода false→true нет, sync не срабатывает, сцена
    // висит с hidden и data-state="closed". Поэтому холодный старт
    // (флаг поднимает эффект подключения) оставляет phase='closed',
    // а фазовый эффект ниже переводит её в 'open' — машина видит
    // переход и открывается. Поймано браузерным прогоном modals.mjs
    // (сценарий 2), регрессия снятия ready()-гейта (D9).
    mounted = true
  })

  // Следим ТОЛЬКО за `open`. Если читать здесь `phase` реактивно, эффект
  // перезапускается от собственной же записи и гасит свой таймер выхода —
  // сцена тогда остаётся в DOM навсегда (поймано прогоном в браузере).
  $effect(() => {
    const isOpen = open
    if (!mounted) return
    const current = untrack(() => phase)

    if (isOpen && current === 'closed') {
      if (coldStart) {
        coldStart = false
        // 🔴 Перевод фазы — на СЛЕДУЮЩИЙ такт, не синхронно.
        //
        // `watch` диалога подписан на `open` через `track` из @zag-js/svelte,
        // а тот ПРОПУСКАЕТ первый запуск (только запоминает deps). Если
        // `mounted=true` и `phase='open'` попадают в один flush, RootProvider
        // рождается сразу с open=true — перехода нет, track молчит, машина
        // навсегда остаётся closed (сцена висит с hidden). На следующий такт
        // RootProvider уже смонтирован с open=false и видит переход.
        // Регрессия вскрыта браузерным прогоном modals.mjs (сценарий 2):
        // открытие кликом не страдало — там машина рождалась закрытой.
        const timer = setTimeout(() => {
          if (untrack(() => phase) === 'closed') phase = 'open'
        }, 0)
        return () => clearTimeout(timer)
      }
      phase = 'starting'
      // двойной rAF: гарантируем, что стартовый кадр отрисован
      let r2 = 0
      const r1 = requestAnimationFrame(() => {
        r2 = requestAnimationFrame(() => {
          if (untrack(() => phase) === 'starting') phase = 'open'
        })
      })
      return () => {
        cancelAnimationFrame(r1)
        if (r2) cancelAnimationFrame(r2)
      }
    }

    if (!isOpen && current !== 'closed') {
      // выход последней модалки: transition к data-ending-style;
      // содержимое снимаем ПОСЛЕ полного перехода
      phase = 'ending'
      /**
       * 🔴 Длительность перехода читаем ТОЛЬКО на следующем кадре.
       *
       * `data-ending-style` ставится этой же записью состояния, а в DOM
       * попадает после флаша. Прочитать стиль сразу — значит увидеть
       * базовый переход оболочки (320 мс) даже когда анимация выключена
       * (`data-[ending-style]:transition-none` из MODAL_CLOSE_ANIMATION_CLASSES):
       * сцена висела лишние 320 мс и исчезала ПОЗЖЕ фона.
       */
      let timer = 0
      const raf = requestAnimationFrame(() => {
        timer = setTimeout(() => {
          if (untrack(() => phase) !== 'ending') return
          phase = 'closed'
          // Память чистим ТОЛЬКО когда анимация доиграла, иначе уходящая
          // модалка мигнёт скелетоном. Порт `clearMemoryIfNeeded`.
          if (untrack(() => config.clearOnClose) && modals.chain.length === 0) {
            modals.store.clearMemory()
          }
        }, exitWaitMs(popupEl)) as unknown as number
      })
      return () => {
        cancelAnimationFrame(raf)
        clearTimeout(timer)
      }
    }

    if (isOpen && current === 'ending') {
      // закрытие отменили — модалку успели открыть обратно
      phase = 'open'
    }
  })

  const visible = $derived(phase !== 'closed')
  const starting = $derived(phase === 'starting')
  const ending = $derived(phase === 'ending')

  /* ── политика закрытия ───────────────────────────────────────────── */

  /**
   * Закрытием владеет цепочка, а не диалог: Esc и клик по фону снимают
   * ОДИН слой, а `open` остаётся true, пока в цепочке что-то есть.
   * Поэтому машине запрещено закрываться самой — её внутреннее состояние
   * не вернулось бы в open от неизменившегося пропа, и стопка из 2+ слоёв
   * схлопнулась бы после первого Esc.
   */
  function onEscape() {
    // Если поверх модалки открыт host-owned floating (select/menu), Escape
    // закрывает сначала его. Иначе при фокусе на trigger'е Ark успевал
    // отдать Escape модальной машине и закрывал owner modal вместе с меню.
    const topFloating = [...floatings].reverse().find((floating) => floating.dismiss?.escape !== false)
    if (topFloating) {
      closeFloating(topFloating.id, 'escape')
      return
    }
    if (locked) return
    modals.close()
  }

  function onInteractOutside(event: Event) {
    // Эвристики `if (event.type === 'focusin') return` из оригинала здесь НЕТ.
    //
    // Она была обходным путём: чужой портал при закрытии возвращал себе
    // фокус, и слой считал это кликом по фону. Штатное средство —
    // `persistentElements` (см. пропсы машины ниже): перечисленные узлы
    // считаются частью диалога. Сцена туда передана, а вложенные оверлеи
    // порталятся именно в неё.
    //
    // Решение D9. Если чек-лист найдёт регресс — вернуть строкой в журнал §6,
    // а не молча.
    const target = event.target as Node | null
    // Кнопка закрытия на фоне — это клик, а не «фон ничего не делает».
    if (closeBtnEl && target && closeBtnEl.contains(target)) return

    // 🔴 Взаимодействие ВНУТРИ host-owned floating — не «снаружи».
    //
    // Регресс к решению D9 (журнал §6): `persistentElements` узнаёт о новом
    // контейнере на такт позже, чем туда уходит фокус, поэтому Ark шлёт
    // `onFocusOutside` на первый же `focusin` внутри только что открытого
    // списка. Без этой проверки хост закрывал верхнюю запись цепочки:
    // на desktop — саму модалку (клавиатурное открытие select внутри неё),
    // на узком экране — headless-запись, то есть список не удерживался
    // вовсе (ISSUES.md R-05). Проверяем по живым узлам, а не по типу
    // события: клик по фону при этом закрывает модалку как прежде.
    if (target && Object.values(floatingNodes).some((node) => node?.contains(target))) return

    if (Date.now() - lastFloatingClosedAt < 150) return

    // Если поверх модалки открыт host-owned floating (select / menu / sheet),
    // клик по фону закрывает только верхний floating, оставляя модалку открытой.
    const topFloating = [...floatings].reverse().find((floating) => floating.dismiss?.outsidePointer !== false)
    if (topFloating) {
      closeFloating(topFloating.id, 'outside-pointer')
      return
    }

    if (locked || config.backdropClick === 'none') return
    config.onBackdrop?.(config.backdropClick)
    if (config.backdropClick === 'all') modals.closeAll()
    else modals.close()
  }

  /* ── машина Ark ──────────────────────────────────────────────────── */

  // Доступное имя: Ark без `Dialog.Title` оставляет role="dialog" безымянным.
  // Объявлено ДО useDialog — иначе обращение к нему при сборке пропсов машины
  // падает «Cannot access 'label' before initialization» (поймано SSR-прогоном).
  const label = $derived.by(() => {
    if (!shown) return undefined
    return chain.length > 1 ? `${shown.name} (${shown.index + 1} из ${chain.length})` : shown.name
  })

  // Владеем машиной сами (D9): это снимает `ready()`-гейт оригинала,
  // который существовал лишь потому, что Zag берёт `open` в initialState
  // и не замечает смену пропа в том же такте.
  const dialog = useDialog(() => ({
    id: 'modals-host',
    open: visible,
    // Модальность полная и для листа: контент машины указывает на сам
    // усыновлённый узел (см. sheetSurface), поэтому `inert` достаётся
    // странице, а список остаётся живым.
    modal: true,
    preventScroll: true,
    closeOnEscape: false,
    closeOnInteractOutside: false,
    // Возврат фокуса делает машина — ручной `preOpenEl` оригинала не нужен (D9).
    restoreFocus: true,
    persistentElements,
    onEscapeKeyDown: onEscape,
    onInteractOutside: (e: any) => onInteractOutside(e.detail?.originalEvent ?? e),
    'aria-label': label,
  }))

  /**
   * 🔴 Вторая машина — на модальную поверхность листа.
   *
   * У диалога Zag ровно один контент, и его эффекты привязываются к узлу
   * при открытии: смена `ids.content` на лету их НЕ перезапускает (это
   * измерено — ловушка оставалась на сцене). Значит «одна машина на стопку»
   * верно ровно до тех пор, пока модальная поверхность одна.
   *
   * Лист — вторая поверхность: он живёт в своём контейнере и может лежать
   * поверх обычной модалки. Поэтому у него своя машина, которая берёт
   * контентом его собственный узел. Вложенность штатная: dismissable
   * ведёт стек слоёв (`@zag-js/dismissable/layer-stack`), scroll lock и
   * aria-изоляция у каждой машины свои.
   *
   * Это НЕ самодельная модальность: обязанности по-прежнему на Ark,
   * просто машин столько, сколько поверхностей (страж `ark-owns` цел).
   */
  const sheetDialog = useDialog(() => ({
    id: 'modals-host-sheet',
    open: Boolean(sheetSurface),
    modal: true,
    preventScroll: true,
    ...(surfaceId ? { ids: { content: surfaceId } } : null),
    closeOnEscape: false,
    closeOnInteractOutside: false,
    restoreFocus: true,
    'aria-label': sheetSurface?.label,
    // Начальный фокус — сам контейнер, а не поле: на сенсорном вводе фокус
    // в поле поднял бы клавиатуру. Если фокус уже внутри листа (поворот во
    // время набора), не трогаем его.
    initialFocusEl: () => {
      if (!sheetSurface) return null
      const node = floatingNodes[sheetSurface.id] ?? null
      const active = typeof document === 'undefined' ? null : document.activeElement
      if (node && active instanceof HTMLElement && node.contains(active)) return active
      return node
    },
    // Куда вернуть фокус: триггер запоминается при открытии, потому что
    // floating снимается раньше деактивации ловушки.
    finalFocusEl: () => {
      const el = sheetSurface ? focusableTrigger(sheetSurface.triggers) : lastSheetTrigger
      return el && el.isConnected ? el : null
    },
    onEscapeKeyDown: onEscape,
    onInteractOutside: (e: any) => onInteractOutside(e.detail?.originalEvent ?? e),
  }))

  // Сцена — контейнер вложенных оверлеев.
  setOverlayContainer({
    get node() {
      return stageEl ?? undefined
    },
  })

  const css = (o: Record<string, string | number | undefined>) =>
    Object.entries(o)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${k}:${v}`)
      .join(';')
</script>

{#if children}{@render children()}{/if}

{#if mounted}
  <!--
    `lazyMount` + `unmountOnExit` — штатная стратегия Ark («Conditional
    Rendering» в документации Dialog): корень остаётся смонтированным,
    а портированный контент уходит из DOM, пока закрыт. Это заменяет
    прежний ручной обход бага №23, когда фон приходилось держать
    смонтированным заранее.
  -->
  <Dialog.RootProvider value={dialog} lazyMount unmountOnExit>
    <Portal>
      <!--
        Фон живёт ВНЕ `{#if visible}` — и это не экономия, а почка жизни
        presence-машины (баг №23). Раньше он монтировался вместе со сценой,
        ПОСЛЕ открытия диалога: presence в @zag-js/svelte создаётся с
        present=false, а `track` его watch'а ПРОПУСКАЕТ первый прогон —
        перехода машина не видела и навсегда оставляла на фоне `hidden`
        (display:none, rect 0×0): модалка открывалась без фона. Смонтированный
        заранее фон создается закрытым и ловит переход false→true.
        До открытия его прячет сам presence (`hidden: !present`).
        У оригинала на @ark-ui/solid тот же паттерн работает из коробки —
        там первый прогон реактивности не теряется.
      -->
      <Dialog.Backdrop
        class={MODAL_BACKDROP_CLASS}
        data-modal-backdrop=""
        data-starting-style={starting ? '' : undefined}
        data-ending-style={ending ? '' : undefined}
      />
      {#if visible}
        <div
          class={MODAL_VIEWPORT_CLASS}
          data-modal-viewport=""
          style={css({ ...viewportStyle(anchor), ...(fullpage ? { padding: 0 } : null) })}
        >
          <Dialog.Content
            bind:ref={stageEl}
            class={MODAL_STAGE_CLASS}
            data-modal-stage=""
            data-anchor={anchor ?? 'center'}
            data-fullpage={fullpage || undefined}
          >
            {#if config.closeIcon && !fullpage && !locked}
              <button
                bind:this={closeBtnEl}
                type="button"
                class={MODAL_CLOSE_CLASS}
                data-modal-close=""
                aria-label="Закрыть модалку"
                onclick={() => modals.close()}
              >
                {#if closeIconSlot}{@render closeIconSlot()}{:else}<span aria-hidden="true">×</span>{/if}
              </button>
            {/if}

            {#if active}
              <Tails activeEntry={active} {anchor} {direction} />
            {/if}

            <div
              bind:this={popupEl}
              class={`${MODAL_POPUP_CLASS} ${MODAL_OPEN_ANIMATION_CLASSES[config.openAnimation]} ${MODAL_CLOSE_ANIMATION_CLASSES[config.closeAnimation]}`}
              data-modal-popup=""
              data-starting-style={starting ? '' : undefined}
              data-ending-style={ending ? '' : undefined}
              data-stack-role={sheetSurface ? 'tail' : undefined}
              inert={sheetSurface ? true : undefined}
              style={shown ? css(shellStyle(shown, anchor, config.maxHeight)) : undefined}
            >
              {#if active}
                <Layers />
              {:else if shown}
                <!--
                  Содержимое уходящей модалки. Без него оболочка схлопывалась
                  бы в пустоту до конца exit-фазы: цепочка уже пуста, а слой
                  ещё виден. Порт `ExitContent` из `stack.tsx` — я его сперва
                  не перенёс, поймано сверкой экспортов с оригиналом.
                -->
                <div class={MODAL_LAYER_CLASS} data-modal-layer="">
                  <ModalContent entry={shown} active={false} />
                </div>
              {/if}
            </div>
          </Dialog.Content>
        </div>
      {/if}
    </Portal>
  </Dialog.RootProvider>

  <!--
    Фон листа принадлежит его машине. Провайдер смонтирован всегда (условный
    рендер корня документация прямо не советует), а узел фона появляется
    и исчезает по той же штатной стратегии.
  -->
  <Dialog.RootProvider value={sheetDialog} lazyMount unmountOnExit>
    <Portal>
      <Dialog.Backdrop class={MODAL_BACKDROP_CLASS} data-modal-backdrop="" />
    </Portal>
  </Dialog.RootProvider>

  {#each floatings as floating (floating.id)}
    {@const geometry = floatingGeometry(floating)}
    {@const surface = floating.id === sheetSurface?.id}
    <Portal container={floating.portalTarget}>
      <!--
        Когда оверлей и есть модальная поверхность, на него ложатся пропсы
        контента машины: role, aria-modal, имя, data-state и, главное, id —
        по нему `hideContentBelow` понимает, кого НЕ помечать `inert`.
        `style` пишем своим последним: геометрию считает хост.
      -->
      <div
        {...surface
          ? sheetDialog().getContentProps()
          : // Немодальная поверхность: роль из набора «интерактивных
            // контейнеров» (@zag-js/dom-query/controller.mjs) + id, на
            // который ссылается триггер через aria-controls. По этой паре
            // ловушка фокуса машины стопки считает портированный оверлей
            // своим — штатный механизм «follow controlled elements».
            { role: 'dialog', 'aria-label': floating.label }}
        id={floatingDomId(floating.id)}
        use:registerFloating={floating.id}
        class={`${MODAL_FLOATING_CLASS} ${isSheet(floating) ? floatingLayoutClass(sheetAnchor(floating)) : ''}`}
        data-host-popup=""
        data-host-floating=""
        data-place={geometry.place}
        data-layout={isSheet(floating) ? 'sheet' : 'popup'}
        data-mobile-anchor={isSheet(floating) ? sheetAnchor(floating) : undefined}
        style={geometry.style}
      ></div>
    </Portal>
  {/each}
{/if}
