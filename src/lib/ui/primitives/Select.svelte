<script lang="ts" module>
  import type { SelectOption, SelectSearchMode } from './select-model'

  export type SelectDisplayMode = 'badges' | 'count'
  export type SelectListSize = 'sm' | 'md' | 'lg'
  /**
   * Автофокус поля поиска при открытии списка.
   * `desktop` — компромисс для сенсорного ввода: при `(hover: none) and
   * (pointer: coarse)` список открывается без поднятой клавиатуры, поиск
   * доступен по тапу в поле. Признак берётся по типу ввода, а не по ширине
   * окна: иначе планшет с тачем поднимал бы клавиатуру, а узкое окно
   * десктопа с мышью теряло автофокус.
   */
  export type SelectSearchAutoFocus = 'always' | 'desktop' | 'never'
  /**
   * Когда закрывать список после выбора опции.
   * `single` — дефолт: одиночный select закрывается, multiple остаётся открытым.
   */
  export type SelectCloseOnSelect = boolean | 'single'

  export interface SelectEnhancementConfig {
    search: SelectSearchMode
    searchAutoFocus: SelectSearchAutoFocus
    clearSearchOnSelect: boolean
    closeOnSelect: SelectCloseOnSelect
    display: SelectDisplayMode
    showSelectAll: boolean
    showClear: boolean
    showCount: boolean
    listSize: SelectListSize
    badgeLimit: number
  }

  export const DEFAULT_SELECT_CONFIG: SelectEnhancementConfig = {
    /**
     * 🔴 Канон по умолчанию ищет по ЗНАЧЕНИЮ (`value`). У нас иначе: значением
     * в этом приложении служит идентификатор, а не название — у жанров это id
     * из справочника источника («27»), у возможностей — латинские токены
     * (`tv_13`). Человек в поле поиска набирает то, что видит, — подпись.
     * `both` делает подпись находимой, не отбирая прежнюю возможность искать
     * по значению.
     */
    search: 'both',
    searchAutoFocus: 'desktop',
    clearSearchOnSelect: true,
    closeOnSelect: 'single',
    display: 'badges',
    showSelectAll: true,
    showClear: true,
    showCount: true,
    listSize: 'md',
    badgeLimit: 2,
  }

  /**
   * Запасной порог, ниже которого список раскрывается слоем, а не popup-menu.
   *
   * Используется ТОЛЬКО когда хоста нет: с хостом порог берётся из его
   * настроек (`config.mobileBreakpoint`), чтобы источник истины был один.
   * Раньше здесь было захардкожено 1024 против 768 у хоста — в диапазоне
   * 768–1023 хост уже считал экран широким, а select ещё узким.
   */
  export const SELECT_FALLBACK_BREAKPOINT = 1024
</script>

<script lang="ts">
  /**
   * Progressive select: нативный контрол владеет формами и no-JS, а после
   * гидратации список уезжает в host-owned оверлей.
   *
   * На широком экране это host popup-menu (не запись цепочки, но
   * persistentElement хоста). На узком тот ЖЕ контейнер становится
   * headless-записью реального потока: история, хвосты, фон и scroll-lock
   * приходят от ModalHost, а список не меняет DOM-родителя.
   *
   * Сам список вынесен в SelectList.svelte; его состояние остаётся здесь.
   */
  import { Portal } from '@ark-ui/svelte/portal'
  import type { HTMLSelectAttributes } from 'svelte/elements'
  import { useInteractionModality } from '@ark-ui/svelte/interaction'
  import { onMount, untrack, type Snippet } from 'svelte'
  import { cn } from '../cn'
  import { tryUseModals, type HostFloatingCloseReason } from '$lib/modals/svelte'
  import { createMediaQuery } from '$lib/modals/svelte'
  import type { MobileAnchor } from '$lib/modals'
  import { inputVariants } from './field'
  import SelectList from './SelectList.svelte'

  /**
   * Пропы нативного контрола едут как есть: `id`, `aria-describedby`,
   * `aria-invalid`, `title`, `form`, `autocomplete`, `tabindex`…
   *
   * Раньше списка атрибутов не было вовсе — и вместе с ними молча пропадал
   * `id`: `<label for>` не находил адресата, а форма проекта (`$lib/form`)
   * не могла положить в поле свои `f.attrs` (тот же `id` плюс связи
   * доступности). Видимый «триггер» ниже — только рисунок (`aria-hidden`,
   * `tabindex="-1"`), поэтому атрибуты принадлежат нативному `select`: он и
   * есть контрол формы, и он же — элемент для подписи.
   */
  interface Props
    extends Omit<HTMLSelectAttributes, 'size' | 'multiple' | 'value' | 'class' | 'onchange' | 'children'> {
    options: readonly SelectOption[]
    value?: string | string[]
    placeholder?: string
    size?: 'sm' | 'md' | 'lg'
    multiple?: boolean
    disabled?: boolean
    name?: string
    /**
     * `id` нативного `select` — то, на что указывает `<label for>`.
     *
     * Без этого пропа внешняя подпись молча ни на что не ссылалась: элемент
     * оставался без идентификатора, и `<label for="…">` не фокусировал контрол
     * (в форме фильтров так и было — `for` приходил из имени поля). lib/form
     * идентификаторы даёт сам (`attrs.id`, `labelProps().for`), а примитиву их
     * должен дать потребитель — или взять сгенерированный.
     */
    id?: string
    /**
     * Связь с текстом-пояснением (`aria-describedby`): приходит от потребителя
     * (например, «почему поле выключено» под контролом). Уходит на НАТИВНЫЙ
     * select — тот же узел, что несут `id`/`name`, поэтому связь не разъедется.
     */
    'aria-describedby'?: string
    required?: boolean
    /** Классы внешней обёртки (по умолчанию `w-full`). */
    wrapperClass?: string
    /** Ширина раскрытого списка: по полю или по содержимому. */
    listWidth?: 'trigger' | 'auto'
    /**
     * 🔴 Направления и режима у списка НЕТ намеренно.
     *
     * Список — часть потока модалок, а не самостоятельный виджет: он
     * создаётся через хост и подчиняется его настройкам, наследуя
     * направление активной модалки. Прежние пропы `mobile`,
     * `mobileAnchor` и `sheetOnNarrow` позволяли списку выбиваться из
     * потока — и выбивались (список выезжал снизу, когда модалка
     * прижата справа). Меню шапки такие опции иметь может, список — нет.
     */
    /** Закрывать список после выбора: true/false или дефолтное 'single'. */
    closeOnSelect?: SelectCloseOnSelect
    class?: string
    config?: Partial<SelectEnhancementConfig>
    onchange?: (values: string[]) => void
    children?: Snippet
  }

  let {
    options, value = $bindable(), placeholder, size = 'md', multiple = false,
    disabled = false, name, id, 'aria-describedby': ariaDescribedby, required, wrapperClass, listWidth = 'trigger',
    closeOnSelect,
    class: cls, config: cfgProp, onchange,
    ...rest
  }: Props = $props()

  /**
   * Идентификатор нативного контрола: явный `id` или сгенерированный.
   *
   * Сгенерированный (`$props.id()`) стабилен между сервером и клиентом, поэтому
   * разметка не расходится при гидратации, а подпись/подсказки привязываются к
   * существующему узлу сами — «тихо не сработавшая» связь больше невозможна.
   */
  const uid = $props.id()
  const selectId = $derived(id ?? uid)

  const config = $derived({
    ...DEFAULT_SELECT_CONFIG,
    ...cfgProp,
    ...(closeOnSelect !== undefined ? { closeOnSelect } : {}),
  })

  /* ── состояние ───────────────────────────────────────────────────── */

  let rootEl = $state<HTMLElement | null>(null)
  let nativeEl = $state<HTMLSelectElement | null>(null)
  let mounted = $state(false)
  let open = $state(false)
  /**
   * Внутренний выбор контрола. Инициализируется пропом (он же — значение для
   * SSR), дальше им владеет контрол: см. эффект внешнего значения ниже.
   */
  let selected = $state<SelectOption[]>(
    untrack(() => options.filter((o) => new Set(valuesOf(value)).has(o.value))),
  )

  /**
   * Хост, если он смонтирован. На desktop просим host popup-menu, на mobile —
   * transient layer. Контекста может не быть: тогда desktop падает в локальный
   * popup под контролом, а mobile остаётся тем же локальным fullscreen CSS.
   */
  const host = tryUseModals()

  // Живой медиазапрос, а не замороженный флаг: при повороте экрана
  // раскладка пересчитывается сама (см. D17).
  //
  // Порог — из настроек хоста: один источник истины на всю систему.
  // Граница `breakpoint - 1`, как у createIsNarrow хоста.
  const narrow = createMediaQuery(
    () => `(max-width: ${(host?.modals.config.mobileBreakpoint ?? SELECT_FALLBACK_BREAKPOINT) - 1}px)`,
  )
  const asLayer = $derived(narrow.matches)

  /**
   * Тип ввода, а не ширина окна.
   *
   * 🔴 Автофокус поля поиска поднимает экранную клавиатуру — это вопрос
   * «чем человек тыкает», а не «какой ширины окно». По ширине выходило
   * двойное враньё: планшет 1100px с тачем получал клавиатуру поверх
   * списка, а узкое окно десктопа с мышью теряло удобный автофокус.
   */
  const coarsePointer = createMediaQuery(() => '(hover: none) and (pointer: coarse)')

  /**
   * Список оформлен листом: тот же узел, другое оформление.
   * Признак нужен и панели — она прячет десктопные действия и показывает
   * мобильную шапку. Раньше его роль играл отдельный transient-слой.
   */
  const sheet = $derived(asLayer && host !== undefined)

  /**
   * Фолбэк без хоста на узком экране: тот же лист, но по своим правилам —
   * раньше это делал @media-блок в app.css. Условие совпадает с веткой
   * разметки `{:else}` (без хоста), поэтому порог у вёрстки и у оформления
   * списка общий — живой media query, а не продублированное число.
   */
  const inlineFallbackSheet = $derived(asLayer && host === undefined)

  let popupId = $state<string | null>(null)
  let lastClosedAt = 0

  // Модальность ввода — от Ark, вместо ручного трекинга pointerType.
  const modality = useInteractionModality()

  /* ── производные ─────────────────────────────────────────────────── */

  const all = $derived([...options])
  const listHeight = $derived(
    config.listSize === 'sm' ? '12rem' : config.listSize === 'lg' ? '24rem' : '18rem',
  )
  const popupNode = $derived(popupId && host ? host.floating.container(popupId) : undefined)
  const closeOnSelectMode = $derived(config.closeOnSelect ?? 'single')
  const shouldCloseOnSelect = $derived(
    closeOnSelectMode === true || (closeOnSelectMode === 'single' && !multiple),
  )

  const optionsByValue = (values: string[]) => {
    const want = new Set(values)
    return all.filter((o) => want.has(o.value))
  }

  /** Значения пропа `value` в виде строк — одна форма для одиночного и множественного. */
  function valuesOf(source: string | readonly string[] | null | undefined): string[] {
    return (Array.isArray(source) ? source : [source ?? '']).map(String)
  }

  /** Набор значений как один ключ — по нему видно, изменилось ли внешнее значение. */
  const valuesKey = (values: Iterable<string>) => [...values].sort().join('\u0000')
  /**
   * Значения, записанные самим контролом. Свой `commit` возвращается пропом
   * (`value = …` и повторный рендер родителя, не знающего о выборе) — это не
   * внешнее изменение, иначе выбор гасился бы собственной же записью.
   */
  const selfWritten = new Set<string>()

  /** Выбранное во внутреннем состоянии — то, чем рисуется и нативный контрол, и список. */
  const selectedValues = $derived(new Set(selected.map((o) => o.value)))

  /**
   * Проп `value` — ВНЕШНЕЕ значение (адрес, хранилище), а не «текущее».
   *
   * 🔴 Раньше выбранность рисовалась ПРЯМО из пропа (`selected={nativeValues…}`),
   * и любой повторный рендер родителя возвращал контролу значение пропа. В форме
   * фильтров родитель отдаёт значение из адреса и на выбор пользователя не
   * реагирует, поэтому первый же повторный рендер панели гасил только что
   * сделанный выбор — «у одиночного select выбор сразу сбрасывается».
   *
   * Теперь выбор живёт в контроле (`selected` + нативный `<select>`), а проп
   * применяется ТОЛЬКО когда он реально сменился: чип/адрес/хранилище поменялись
   * извне — приняли, повторный рендер с тем же пропом — не трогаем.
   */
  function writeValues(values: Set<string>): void {
    if (nativeEl) {
      for (const o of Array.from(nativeEl.options)) o.selected = values.has(o.value)
    }
    selected = all.filter((o) => values.has(o.value))
  }

  /* ── синхронизация с нативным контролом ──────────────────────────── */

  function syncFromNative() {
    const values = new Set(
      Array.from(nativeEl?.selectedOptions ?? [], (o) => o.value),
    )
    selected = all.filter((o) => values.has(o.value))
    return values
  }

  function commit(next: readonly SelectOption[]) {
    const values = new Set(next.map((o) => o.value))
    if (nativeEl) {
      for (const o of Array.from(nativeEl.options)) o.selected = values.has(o.value)
      // Нативный контрол — источник истины для формы: события шлём от него.
      nativeEl.dispatchEvent(new Event('input', { bubbles: true }))
      nativeEl.dispatchEvent(new Event('change', { bubbles: true }))
    }
    selected = all.filter((o) => values.has(o.value))
    // Своя запись вернётся пропом — пометим, чтобы не принять её за внешнюю.
    selfWritten.add(valuesKey(values))
    value = multiple ? [...values] : ([...values][0] ?? '')
    onchange?.([...values])
    // Строка поиска живёт в панели (шаг E2): очистку после выбора делает она.
    if (shouldCloseOnSelect) setOpen(false)
  }

  /* ── геометрия host popup-menu ───────────────────────────────────── */

  function popupOptions() {
    const rect = (rootEl ?? nativeEl)?.getBoundingClientRect()
    if (!rect) return null
    return {
      rect: {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      },
      triggers: [rootEl, nativeEl],
      listWidth,
      minWidth: rect.width,
      // Режим и направление НЕ передаём: список следует хосту и активной
      // модалке. Хост сам решит, лист это или выпадашка, и куда прижать.
      label: placeholder ?? 'Выбор',
      placement: {
        gap: 4,
        minSideSpace: 144,
        maxOverlayHeight: Math.min(380, window.innerHeight - 16),
      },
      onClose: (reason: HostFloatingCloseReason) => closeFromHostFloating(reason),
    }
  }

  function openHostPopup() {
    if (!host || popupId !== null) return
    const options = popupOptions()
    if (!options) return
    // Select — не произвольное меню: на узком экране он обязан войти в
    // реальный поток модалок и наследовать направление активной записи.
    // Это фиксировано API хоста (`openFlow`), а не публичной опцией Select.
    popupId = host.floating.openFlow(options)
  }

  function closeHostPopup() {
    if (!host || popupId === null) return
    const id = popupId
    popupId = null
    host.floating.close(id)
  }

  function closeFromHostFloating(reason: HostFloatingCloseReason) {
    popupId = null
    lastClosedAt = Date.now()
    // Programmatic close is initiated by this component itself (setOpen(false),
    // unmount, or desktop⇄mobile transfer) and must not flip `open` while the
    // same SelectList is moving between host.floating and transient layer.
    if (reason === 'programmatic' || reason === 'transfer') return
    if (!open) return
    open = false
    if (reason === 'escape') nativeEl?.focus({ preventScroll: true })
  }

  /* ── открытие и закрытие ─────────────────────────────────────────── */

  const autoFocusSearch = $derived.by(() => {
    if (config.search === 'off') return false
    // С клавиатуры фокус в поле нужен всегда: на нём висят стрелки и Enter.
    if (modality() === 'keyboard') return true
    if (config.searchAutoFocus === 'never') return false
    if (config.searchAutoFocus === 'desktop') return !coarsePointer.matches
    return true
  })

  /**
   * Отдавать ли фокус полю при открытии — ДРУГОЙ вопрос, чем «можно ли в
   * поле печатать» (`searchArmed`).
   *
   * При выключенном поиске поле спрятано и нередактируемо, но фокус ему
   * всё равно нужен: по модели APG DOM-фокус остаётся на combobox, а по
   * опциям ходит виртуальный через aria-activedescendant. Без фокуса
   * стрелки и Enter просто некому принять.
   *
   * Когда автофокус выключен намеренно (мобильный слой), фокус уходит не
   * в поле, а на сам слой: клавиатурная навигация жива, а экранная
   * клавиатура не выезжает.
   */
  const focusInputOnOpen = $derived(config.search === 'off' || autoFocusSearch)

  function setOpen(next: boolean) {
    if (disabled) return
    if (next) {
      if (Date.now() - lastClosedAt < 250) return
      syncFromNative()
      open = true
      if (host) openHostPopup()
    } else {
      open = false
      closeHostPopup()
      nativeEl?.focus({ preventScroll: true })
    }
  }

  /* ── перехват нативного контрола ─────────────────────────────────── */

  /**
   * Гашение «догоняющего» клика после открытия по указателю.
   *
   * 🔴 Открытие происходит на `pointerdown` (иначе Android поднимает свой
   * picker), но тот же жест оставляет после себя `click` — и он прилетает
   * УЖЕ в смонтированный список: в пункт, который оказался на месте контрола.
   * Со стороны это выглядит как «я нажал по select, а он сам выбрал вариант»
   * (и значение уезжает мимо хранилища). Гасим ровно один клик этого жеста:
   * слушатель снимает себя сам, а если клика не было — снимается по таймауту.
   */
  let swallowArmed = false
  function swallowTrailingClick(): void {
    if (swallowArmed) return
    swallowArmed = true
    const armedAt = Date.now()
    const cleanup = () => {
      swallowArmed = false
      window.removeEventListener('click', onClick, true)
      window.removeEventListener('pointercancel', cleanup, true)
      window.clearTimeout(timer)
    }
    const onClick = (event: MouseEvent) => {
      cleanup()
      if (Date.now() - armedAt > 700) return // чужой жест — не наш клик
      event.preventDefault()
      event.stopPropagation()
    }
    const timer = window.setTimeout(cleanup, 800)
    window.addEventListener('click', onClick, true)
    window.addEventListener('pointercancel', cleanup, true)
  }

  // `preventDefault` нужен и для touch: иначе Android поднимет собственный
  // picker нативного `<select>` раньше, чем мы успеем открыть свой список.
  function interceptPointer(event: PointerEvent | MouseEvent) {
    if (!mounted || disabled || event.defaultPrevented) return
    event.preventDefault()
    const wasOpen = open
    setOpen(true)
    // Список открылся именно этим жестом — значит следом придёт его клик.
    if (!wasOpen && open) swallowTrailingClick()
  }
  function interceptKey(event: KeyboardEvent) {
    if (!mounted || disabled || event.defaultPrevented) return
    if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault()
      setOpen(true)
    }
  }

  onMount(() => {
    // 🔴 Сначала ВОССТАНОВИТЬ выбор нативного контрола из value, и только
    // потом читать его. При ПЕРЕСОЗДАНИИ компонента (например, {#key}
    // вокруг страницы) Svelte применяет `selected`-свойства опций раньше,
    // чем `multiple` селекта: в этот миг селект ведёт себя как одиночный —
    // каждая следующая выбранная опция сбрасывает предыдущую, и от
    // множественного выбора остаётся только ПОСЛЕДНЯЯ (баг №24: панель
    // источников теряла отмеченность, показывая [memory] вместо
    // [local,memory]). На первом маунте порядок верный — поэтому баг
    // всплывал только после пересоздания.
    if (nativeEl && multiple) {
      for (const o of Array.from(nativeEl.options)) o.selected = selectedValues.has(o.value)
    }
    syncFromNative()
    mounted = true
    const form = nativeEl?.form
    const onReset = () => queueMicrotask(syncFromNative)
    form?.addEventListener('reset', onReset)
    return () => form?.removeEventListener('reset', onReset)
  })

  /**
   * Применение внешнего значения: проп `value` изменился НА САМОМ ДЕЛЕ
   * (адрес, чип, хранилище) — принимаем его. Повторная передача того же
   * значения (обычный повторный рендер родителя) выбора не касается.
   */
  let appliedKey: string | null = null

  $effect(() => {
    const values = valuesOf(value)
    const key = valuesKey(values)
    // Опции пересобрались — DOM остаётся источником истины для выбора.
    void options
    if (!mounted || !nativeEl) {
      appliedKey = key
      return
    }
    if (selfWritten.delete(key) || key === appliedKey) {
      queueMicrotask(syncFromNative)
      return
    }
    appliedKey = key
    writeValues(new Set(values))
  })

  /** Desktop popup двигается за триггером. */
  $effect(() => {
    if (!open || !host || popupId === null) return
    const update = () => {
      if (popupId === null) return
      const options = popupOptions()
      if (options) host.floating.update(popupId, options)
    }
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  })

  /** Local fallback без ModalHost: закрываем меню по Esc и клику снаружи. */
  $effect(() => {
    if (!open || host) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (target && rootEl?.contains(target)) return
      setOpen(false)
    }
    const onKeydown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeydown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeydown)
    }
  })

  /** Если компонент размонтировали открытым, не оставляем слой/попап в хосте. */
  $effect(() => {
    return () => {
      closeHostPopup()
    }
  })

  /*
   * Эффектов поворота больше нет.
   *
   * Раньше здесь жили два $effect, которые при смене ориентации закрывали
   * один вид и открывали другой — то есть пересоздавали список в другом
   * месте дерева. Теперь узел один, а хост меняет на нём только поведение
   * и data-layout, поэтому ни фокус, ни каретка, ни скролл не теряются.
   */
</script>

<!--
  Единственное место, где рождается список.

  Раньше `SelectList` вызывался из трёх веток шаблона (transient-слой,
  host-floating, inline), и переход между ними создавал НОВЫЙ экземпляр:
  фокус, каретка в поиске и позиция скролла терялись. Теперь ветки
  отличаются только параметром, а набор пропсов один и не разъезжается.

  Полноценное «монтируется один раз» даст overlay-плоскость: контейнер
  должен переезжать вместе со списком, а не пересоздаваться.
-->
{#snippet selectBody(variant: 'host' | 'inline')}
  <SelectList
    {options}
    {selected}
    {multiple}
    {placeholder}
    {config}
    {listHeight}
    {autoFocusSearch}
    {focusInputOnOpen}
    {listWidth}
    {commit}
    asLayer={sheet}
    hostMenu={variant === 'host'}
    // Подсветка опций — эффект наведения: на тач-экране её нет (см. SelectList).
    pointerHighlight={!coarsePointer.matches}
    // Без хоста на узком экране список и раньше раскрывался на весь экран —
    // это делал @media-блок в app.css по селектору `[data-select-positioner]`.
    // Теперь то же условие приходит пропом, из того же живого media query.
    narrowInline={variant === 'inline' && inlineFallbackSheet}
    close={() => setOpen(false)}
  />
{/snippet}


<div
  bind:this={rootEl}
  class={cn('group/select relative', wrapperClass ?? 'w-full', disabled && 'opacity-50')}
  data-select-root=""
  data-enhanced={mounted ? '' : undefined}
  data-expanded={open ? '' : undefined}
>
  <!--
    Нативный контрол остаётся в разметке всегда: он владеет формой и
    работает без JS. После гидратации ложится прозрачным поверх видимого
    контрола Ark/host (D18) — прятать его `display:none` нельзя, иначе браузер
    не покажет на нём сообщение `required`.
  -->
  <!--
    Шаг H: состояние «раскрыт ли список» принадлежит ТРИГГЕРУ.
    Нативный `select` с `size=1` отображается в роль combobox, поэтому
    `aria-expanded` и `aria-haspopup` вешаются на него. У множественного
    выбора роль — listbox, где `aria-expanded` не применяется, поэтому
    там атрибутов нет. В самой панели `aria-expanded="true"` корректен:
    панель существует только в раскрытом состоянии.
  -->
  <select
    bind:this={nativeEl}
    data-select-native=""
    id={selectId}
    {...rest}
    {name}
    aria-describedby={ariaDescribedby}
    {required}
    {disabled}
    multiple={multiple}
    aria-haspopup={mounted && !multiple ? 'listbox' : undefined}
    aria-expanded={mounted && !multiple ? open : undefined}
    aria-controls={open && popupNode?.id ? popupNode.id : undefined}
    data-select-native-multiple={multiple ? '' : undefined}
    class={inputVariants({
      size,
      class: cn(
        multiple
          // Прежний `.select-native-multiple` из app.css: h-auto + min-h-28,
          // но без минимума, как только контролом управляет JS (data-enhanced)
          // или экран узкий.
          ? 'h-auto min-h-28 py-2 pr-3 max-lg:min-h-0 group-data-[enhanced]/select:min-h-0'
          : 'pr-8',
        mounted && 'absolute inset-0 z-10 m-0 h-full min-h-0 cursor-pointer opacity-0',
        open && 'pointer-events-none',
        cls,
      ),
    })}
    oninput={syncFromNative}
    onchange={syncFromNative}
    onpointerdown={interceptPointer}
    onmousedown={interceptPointer}
    onkeydown={interceptKey}
  >
    {#if placeholder !== undefined && !multiple}
      <option value="" selected={selectedValues.has('')}>{placeholder}</option>
    {/if}
    {#each all as option (option.value)}
      <option value={option.value} disabled={option.disabled} selected={selectedValues.has(option.value)}>
        {option.label}
      </option>
    {/each}
  </select>

  {#if mounted}
    <button
      type="button"
      aria-hidden="true"
      tabindex="-1"
      class={cn(inputVariants({ size }), 'flex w-full items-center justify-between gap-2', cls)}
      data-select-trigger=""
    >
      <span class="flex min-w-0 flex-1 items-center gap-1 text-left">
        {#if selected.length === 0}
          <span class="truncate text-muted-foreground">{placeholder ?? 'Выберите…'}</span>
        {:else if multiple && config.display === 'count'}
          <span class="truncate">Выбрано {selected.length}</span>
        {:else if multiple && config.display === 'badges'}
          {#each selected.slice(0, config.badgeLimit) as o (o.value)}
            <span
              class="max-w-[9rem] truncate rounded bg-accent px-1.5 py-0.5 text-xs"
              data-select-badge=""
            >
              {o.label}
            </span>
          {/each}
          {#if selected.length > config.badgeLimit}
            <span class="text-xs text-muted-foreground">
              +{selected.length - config.badgeLimit}
            </span>
          {/if}
        {:else}
          <span class="truncate">{selected.map((o) => o.label).join(', ')}</span>
        {/if}
      </span>
      <svg aria-hidden="true" viewBox="0 0 16 16" class="h-4 w-4 shrink-0 fill-none stroke-current stroke-2">
        <path d="m4 6 4 4 4-4" />
      </svg>
    </button>

    {#if open}
      {#if host}
        {#if popupNode}
          <Portal container={popupNode}>
            <div
              data-select-positioner=""
              data-host-menu=""
              class="static inset-auto h-auto w-full min-w-0 transform-none z-auto"
            >
              {@render selectBody('host')}
            </div>
          </Portal>
        {/if}
      {:else}
        <!--
          Фолбэк без хоста. Узкий экран решается здесь тем же живым
          media query, что и оформление списка (narrowInline): раньше это
          делал @media-блок в app.css, и порог был продублирован в CSS.
        -->
        <div
          data-select-positioner=""
          class={inlineFallbackSheet
            ? 'fixed inset-0 z-70 w-screen h-dvh min-w-0 transform-none'
            : 'absolute left-0 top-full z-70 mt-1 w-full'}
        >
          {@render selectBody('inline')}
        </div>
      {/if}
    {/if}
  {/if}
</div>
