<script lang="ts">
  import { onMount } from 'svelte'
  import { cn } from '../cn'
  import SearchField from './SearchField.svelte'
  import {
    matchesSelectOption,
    selectedAfterToggle,
    selectedAfterToggleAll,
    type SelectOption,
  } from './select-model'
  import type { SelectEnhancementConfig } from './Select.svelte'

  interface Props {
    options: readonly SelectOption[]
    selected: readonly SelectOption[]
    multiple: boolean
    placeholder?: string
    config: SelectEnhancementConfig
    listHeight: string
    autoFocusSearch: boolean
    /** Отдать фокус полю при открытии. Шире, чем autoFocusSearch: см. Select. */
    focusInputOnOpen?: boolean
    asLayer?: boolean
    hostMenu?: boolean
    /**
     * Фолбэк без хоста на узком экране: список раскрывается на весь экран.
     * Раньше это делал `@media (max-width: 1024px)` для
     * `[data-select-positioner]:not([data-host-menu])`; теперь режим приходит
     * пропом из Select (там живёт тот же живой media query), поэтому у
     * раскрытия нет ни дублирующего порога, ни зависимости от порядка CSS.
     */
    narrowInline?: boolean
    /**
     * Подсвечивать ли опцию под указателем (и активную опцию вообще).
     *
     * 🔴 Подсветка — эффект наведения, а наведение есть не у всякого ввода.
     * На тач-экране браузер после касания шлёт совместимые мышиные события
     * (`mouseover`/`mousemove` в точке пальца), и они попадают в опцию: список
     * открывается с подсвеченной строкой, которой никто не наводил, а при
     * движении пальца подсветка «проскакивает» по строкам. Признак берётся по
     * возможностям ввода (`hover: none` + `pointer: coarse` — см. Select), а не
     * по ширине окна: планшет с тачем и узкое окно десктопа различаются именно
     * этим. Клавиатура не страдает: она ходит по опциям своими ключами
     * (`onKeydown` → `moveActive`) и подсветку включает сама — для этого и
     * нужен второй источник признака ниже.
     */
    pointerHighlight?: boolean
    listWidth?: 'trigger' | 'auto'
    commit: (next: readonly SelectOption[], keepOpen?: boolean) => void
    close: () => void
  }

  let {
    options,
    selected,
    multiple,
    placeholder,
    config,
    listHeight,
    autoFocusSearch,
    focusInputOnOpen = autoFocusSearch,
    asLayer = false,
    hostMenu = false,
    narrowInline = false,
    pointerHighlight = true,
    listWidth = 'trigger',
    commit,
    close,
  }: Props = $props()

  let searchInput = $state<HTMLInputElement | null>(null)
  let searchArmed = $state(false)
  let activeIndex = $state(0)
  /**
   * Клавиатура включила подсветку: на тач-экране её нет, пока по опциям не
   * пошли стрелками (см. проп `pointerHighlight`).
   */
  let keyboardArmed = $state(false)
  const highlight = $derived(pointerHighlight || keyboardArmed)
  let listboxEl = $state<HTMLElement | null>(null)
  let contentEl = $state<HTMLElement | null>(null)

  /*
   * Клавиатурная модель APG для combobox: DOM-фокус ОСТАЁТСЯ на поле,
   * а по опциям ходит «виртуальный» фокус через aria-activedescendant.
   * Без этих id навигация стрелками была видимой, но для скринридера
   * не существовала: подсветка менялась, а объявлять было нечего.
   */
  const uid = $props.id()
  const listboxId = `${uid}-listbox`
  const optionId = (index: number) => `${uid}-option-${index}`

  const all = $derived([...options])
  const selectedValues = $derived(new Set(selected.map((o) => o.value)))
  const filtered = $derived(
    all.filter((o) => matchesSelectOption(o, query, config.search)),
  )
  const activeOptionId = $derived(
    filtered.length > 0 && filtered[activeIndex] ? optionId(activeIndex) : undefined,
  )

  /*
   * ── Предел отрисовки списка ─────────────────────────────────────────
   * Строка списка — шесть узлов (кнопка, галочка, подпись, пояснение).
   * Справочник студий — 1000 вариантов: 6000 узлов и ~250 мс открытия на
   * телефоне. Поэтому список рисуется первой порцией, а остальное
   * дорисовывается при прокрутке до конца. Поиск идёт по ВСЕМУ списку
   * (`filtered`), а не по нарисованному: введённый запрос достаёт вариант,
   * до которого иначе пришлось бы листать.
   */
  const limit = $derived(Math.max(0, config.renderLimit))
  const chunk = $derived(Math.max(1, config.renderChunk))
  /** Сколько строк добавлено порциями (сверх первой). */
  let extra = $state(0)
  const shown = $derived(
    limit > 0 ? Math.min(filtered.length, limit + extra) : filtered.length,
  )
  const visible = $derived(filtered.slice(0, shown))
  /** Сколько вариантов не нарисовано (0 — нарисован весь список). */
  const hidden = $derived(filtered.length - visible.length)

  /** Прокрутка до конца списка дорисовывает следующую порцию. */
  function loadMore(): void {
    const el = listboxEl
    if (!el || hidden === 0) return
    if (el.scrollTop + el.clientHeight < el.scrollHeight - 24) return
    extra += chunk
  }
  const allVisibleSelected = $derived.by(() => {
    const enabled = filtered.filter((o) => !o.disabled)
    return enabled.length > 0 && enabled.every((o) => selectedValues.has(o.value))
  })

  /**
   * Панель снаружи видна по `data-select-content` (+ `data-select-content-auto`,
   * `data-select-listbox`, `data-select-search-row`, `data-select-actions`,
   * `data-select-mobile-*`): marker-классов у списка больше нет.
   *
   * Шкура панели: фон с текстом и две тени. Значения 1:1 с прежними
   * правилами `.select-content` из app.css: там стояло
   * `var(--card, var(--popover))` — в обеих темах `--card` определён и равен
   * `--popover`, поэтому короткие токены `card` дают тот же цвет, а тень
   * `shadow-md` не берём вовсе: правило из app.css её всё равно перекрывало
   * своей (это и была вторая тень).
   */
  const CONTENT_SKIN =
    'bg-card text-card-foreground shadow-[0_20px_45px_-12px_color-mix(in_oklab,var(--foreground)_30%,transparent),0_6px_16px_-8px_color-mix(in_oklab,var(--foreground)_20%,transparent)]'
  /**
   * Появление панели: было `animation: select-content-in 150ms` со своими
   * кадрами — стало переходом из `@starting-style` (вариант `starting:`).
   * Первый кадр тот же: сдвиг на 4px вверх и масштаб 0.97.
   */
  const CONTENT_FRAMES =
    'origin-[var(--transform-origin)] transition-[opacity,transform] duration-150 ease-out motion-reduce:duration-[1ms] starting:opacity-0 starting:-translate-y-1 starting:scale-[0.97]'
  /** Лист (host-лист или полноэкранный фолбэк): тот же вход, но «снизу». */
  const SHEET_FRAMES =
    'origin-bottom transition-[opacity,transform] duration-150 ease-out motion-reduce:duration-[1ms] starting:opacity-0 starting:translate-y-3'

  /**
   * Полноэкранная раскладка: у листа хоста — потому что узкий контейнер
   * (data-as-layer), у фолбэка — потому что нет хоста и экран узкий.
   */
  const fullscreen = $derived(asLayer || narrowInline)

  /** Сколько места панель занимает в раскрытом виде — 1:1 с прежним CSS. */
  const contentSize = $derived.by(() => {
    if (fullscreen) {
      /**
       * В листе высота ограничена не только «на глаз»: контейнер листа
       * (`h-auto` + `max-h`) объявляет свой бюджет переменной
       * `--host-floating-max-height`. Без этого предела длинный список
       * (например, 80 жанров) растягивал панель до своей высоты, контейнер
       * обрезал её — и прокрутки не было вовсе: список оказывался «ровно
       * по себе», а его хвост недостижим. Полноэкранному фолбэку без хоста
       * предел не нужен: там высота задана явно (`h-dvh`) и определена.
       */
      const cap = asLayer ? 'max-h-[var(--host-floating-max-height,85dvh)]' : 'max-h-none'
      return listWidth === 'auto'
        ? `w-screen h-full max-w-none ${cap}`
        : `w-full h-full max-w-none ${cap}`
    }
    if (hostMenu) {
      const width = listWidth === 'auto'
        ? 'w-max min-w-[var(--reference-width,100%)] max-w-[min(22rem,calc(100vw-16px))]'
        : 'w-full max-w-none'
      return `${width} max-h-[var(--host-floating-max-height,var(--host-popup-max-height,var(--available-height)))]`
    }
    return listWidth === 'auto'
      ? 'w-max min-w-[var(--reference-width,auto)] max-w-[min(22rem,var(--available-width,22rem))]'
      : 'w-full max-h-[var(--available-height)]'
  })

  /** Мобильная шапка панели (счётчик/действия/крестик) — только в листе. */
  const sheetOnly = $derived(fullscreen ? 'inline-flex flex-none' : 'hidden')

  /**
   * Куда уходит фокус при открытии.
   *
   * В поле поиска — когда автофокус уместен. Иначе на сам слой: фокус
   * обязан остаться ВНУТРИ списка, иначе стрелки и Enter некому принять,
   * но не в поле — на сенсорном вводе это подняло бы клавиатуру.
   */
  const focusTarget = () => (focusInputOnOpen ? searchInput : contentEl)

  onMount(() => {
    // «Взведено» — то есть можно печатать и поднимать клавиатуру.
    // Это НЕ то же самое, что «получает фокус».
    searchArmed = autoFocusSearch

    focusTarget()?.focus({ preventScroll: true })

    /**
     * 🔴 Одно переподтверждение на следующем кадре — и ровно одно.
     *
     * Наш фокус спорит с ДЕЙСТВИЕМ БРАУЗЕРА ПО УМОЛЧАНИЮ: клик по нативному
     * `<select>` переводит фокус на него, и этот перевод приходит уже после
     * нашего `focus()`. Кто успеет первым, зависит от того, существует ли
     * контейнер списка к моменту клика: внутри модалки он уже есть (портал
     * в сцену), панель монтируется в том же такте — и фокус отбирал
     * `<select>`. Поэтому проверяем через кадр: если фокус ушёл из панели,
     * возвращаем. Если пользователь увёл его сам — не вмешиваемся.
     *
     * Это НЕ возврат `holdContentFocus`: тот боролся с ловушкой фокуса Ark
     * и будил её повторными вызовами. Здесь один кадр и одно условие.
     */
    const recheck = requestAnimationFrame(() => {
      if (contentEl?.contains(document.activeElement)) return
      focusTarget()?.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(recheck)
  })

  $effect(() => {
    // Новая выборка (запрос, опции) — список снова начинается с первой порции.
    void query
    void options
    extra = 0
  })

  $effect(() => {
    void query
    void options
    if (activeIndex >= filtered.length) activeIndex = Math.max(0, filtered.length - 1)
    // Клавиатура ушла за нарисованную порцию — дорисовываем до неё, иначе
    // виртуальный фокус уехал бы в ненарисованную строку.
    if (limit > 0 && activeIndex + 1 > shown) extra = activeIndex + 1 - limit
  })

  /*
   * Браузер сам НЕ скроллит к элементу, на который указывает
   * aria-activedescendant, — в отличие от настоящего фокуса. Делаем руками,
   * иначе активная опция уезжает за край списка при навигации стрелками.
   */
  $effect(() => {
    const id = activeOptionId
    // `shown` в зависимостях: дорисованная порция — новый узел, к нему и
    // прокручиваем.
    void shown
    if (!id || !listboxEl) return
    listboxEl.querySelector(`#${CSS.escape(id)}`)?.scrollIntoView({ block: 'nearest' })
  })

  function moveActive(delta: number) {
    if (filtered.length === 0) return
    let next = activeIndex
    for (let i = 0; i < filtered.length; i++) {
      next = (next + delta + filtered.length) % filtered.length
      if (!filtered[next]?.disabled) {
        activeIndex = next
        break
      }
    }
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close()
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      event.stopPropagation()
      keyboardArmed = true
      moveActive(1)
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      event.stopPropagation()
      keyboardArmed = true
      moveActive(-1)
      return
    }
    if (event.key === 'Home') {
      event.preventDefault()
      event.stopPropagation()
      keyboardArmed = true
      activeIndex = Math.max(0, filtered.findIndex((o) => !o.disabled))
      return
    }
    if (event.key === 'End') {
      event.preventDefault()
      event.stopPropagation()
      keyboardArmed = true
      const last = filtered.map((o, i) => (o.disabled ? -1 : i)).filter((i) => i >= 0).at(-1)
      activeIndex = last ?? 0
      return
    }
    if (event.key === 'Enter') {
      const option = filtered[activeIndex]
      if (!option || option.disabled) return
      event.preventDefault()
      event.stopPropagation()
      choose(option)
    }
  }

  /**
   * 🔴 Строка поиска принадлежит панели, а не оболочке (шаг E2 плана).
   *
   * Раньше `query` жил в `Select.svelte` и приезжал через `bind:query`:
   * только так он переживал смену desktop⇄mobile, потому что панель
   * пересоздавалась. После behavioural layering панель монтируется один
   * раз, поэтому состояние поиска живёт там, где им пользуются, —
   * и сохраняется само.
   */
  let query = $state('')

  function armSearch() {
    if (!searchInput || config.search === 'off' || searchArmed) return
    searchArmed = true
    searchInput.focus({ preventScroll: true })
  }

  function clearQuery() {
    query = ''
  }

  /** Выбор сделан: оболочке — значения, себе — очистку поиска. */
  function applySelection(next: readonly SelectOption[], keepOpen?: boolean) {
    commit(next, keepOpen)
    if (config.clearSearchOnSelect) query = ''
  }

  function choose(option: SelectOption) {
    if (option.disabled) return
    const next = selectedAfterToggle(selected, option, multiple)
    applySelection(next, !multiple && !next.length)
  }
</script>

<div
  bind:this={contentEl}
  tabindex="-1"
  data-select-content=""
  data-state="open"
  data-as-layer={asLayer || undefined}
  data-host-menu={hostMenu || undefined}
  role="presentation"
  onkeydown={onKeydown}
  class={cn(
    'z-70 flex flex-col overflow-hidden border border-border outline-none',
    CONTENT_SKIN,
    contentSize,
    fullscreen
      ? `${SHEET_FRAMES} rounded-none group-data-[mobile-anchor=bottom]/sheet:rounded-t-[16px] group-data-[mobile-anchor=top]/sheet:rounded-b-[16px] group-data-[mobile-anchor=top]/sheet:origin-top`
      : `rounded-[calc(var(--radius)+2px)] ${CONTENT_FRAMES}`,
  )}
  data-select-content-auto={listWidth === 'auto' ? '' : undefined}
  style="--select-list-height: {listHeight}"
>
  <div
    class={cn(
      'flex items-center gap-2 border-b border-border',
      fullscreen ? 'min-h-14 px-4 py-0' : 'p-2',
    )}
    data-select-search-row=""
  >
    {#if config.showCount && multiple && selected.length > 0}
      <button
        type="button"
        class={cn('h-9 items-center gap-1.5 rounded-md px-2 text-sm font-medium hover:bg-accent', sheetOnly)}
        data-select-mobile-count=""
        aria-label={`Снять выделение: выбрано ${selected.length}`}
        onclick={() => applySelection([])}
      >
        <svg aria-hidden="true" viewBox="0 0 16 16" class="h-4 w-4 fill-none stroke-current stroke-2">
          <path d="m4 4 8 8m0-8-8 8" />
        </svg>
        <span class="tabular-nums">{selected.length}</span>
      </button>
    {/if}

    <SearchField
      filled={!!query}
      onClear={clearQuery}
      disabled={config.search === 'off'}
      class={config.search === 'off' ? 'sr-only' : undefined}
    >
      <input
        bind:this={searchInput}
        bind:value={query}
        role="combobox"
        aria-label="Поиск вариантов"
        aria-expanded="true"
        aria-controls={listboxId}
        aria-activedescendant={activeOptionId}
        aria-autocomplete="list"
        onpointerdown={armSearch}
        onclick={armSearch}
        readonly={config.search === 'off' || !searchArmed}
        inputmode={searchArmed ? 'text' : 'none'}
        placeholder={config.search === 'off' ? '' : 'Поиск…'}
        class={cn(
          'h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 text-base outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 sm:text-sm',
          query && 'pr-9',
        )}
      />
    </SearchField>

    {#if multiple && config.showSelectAll && !allVisibleSelected && filtered.length > 0}
      <button
        type="button"
        class={cn('h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground', sheetOnly)}
        data-select-mobile-action=""
        aria-label={query ? 'Выбрать найденные' : 'Выбрать все'}
        onclick={() => applySelection(selectedAfterToggleAll(selected, filtered, allVisibleSelected))}
      >
        <svg aria-hidden="true" viewBox="0 0 16 16" class="h-4 w-4 fill-none stroke-current stroke-2">
          <path d="m1.5 4.5 1.5 1.5 2.5-2.5M1.5 11l1.5 1.5L5.5 10M8 4.5h6.5M8 12h6.5" />
        </svg>
      </button>
    {/if}

    {#if config.showClear && selected.length > 0 && !(config.showCount && multiple) && (multiple || placeholder !== undefined)}
      <button
        type="button"
        class={cn('h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground', sheetOnly)}
        data-select-mobile-action=""
        aria-label="Очистить"
        onclick={() => applySelection([])}
      >
        <svg aria-hidden="true" viewBox="0 0 16 16" class="h-4 w-4 fill-none stroke-current stroke-2">
          <circle cx="8" cy="8" r="5.5" /><path d="m5.5 10.5 5-5" />
        </svg>
      </button>
    {/if}

    <button
      type="button"
      class={cn('h-9 w-9 items-center justify-center rounded-md hover:bg-accent', sheetOnly)}
      data-select-mobile-close=""
      aria-label="Закрыть"
      onclick={close}
    >
      <svg aria-hidden="true" viewBox="0 0 16 16" class="h-4 w-4 fill-none stroke-current stroke-2">
        <path d="m4 4 8 8m0-8-8 8" />
      </svg>
    </button>
  </div>

  {#if config.showCount && multiple}
    <p
      class={cn('border-b border-border px-3 py-2 text-xs text-muted-foreground', fullscreen && 'hidden')}
      data-select-count-row=""
    >
      Выбрано {selected.length} из {all.filter((o) => !o.disabled).length}
    </p>
  {/if}

  <!--
    Обёртка списка — флекс-колонка в полноэкранном листе: там список обязан
    СТЯГИВАТЬСЯ по высоте листа (`flex-1` + `min-h-0`), а не расти по содержимому.
    Процентная высота (`h-full`) на этом узле не работает: высота обёртки
    приходит от flex-раскладки родителя («auto» в вычисленном виде), поэтому
    80 жанров растягивали список до 2568 px, обрезались `overflow: hidden` —
    и прокрутки не было вовсе. В выпадашке (не лист) прежняя схема верна:
    список там как раз по содержимому, а предел задаёт `max-h`.
  -->
  <div class={cn('min-h-0 flex-1 overflow-hidden', fullscreen && 'flex flex-col')}>
    <div
      bind:this={listboxEl}
      id={listboxId}
      data-select-listbox=""
      role="listbox"
      onscroll={loadMore}
      aria-multiselectable={multiple || undefined}
      class={cn(
        'overflow-y-auto p-1 outline-none',
        fullscreen ? 'min-h-0 flex-1 max-h-none' : 'h-full max-h-[var(--select-list-height)]',
      )}
      tabindex="-1"
    >
      {#each visible as option, index (option.value)}
        {@const checked = selectedValues.has(option.value)}
        <button
          type="button"
          id={optionId(index)}
          role="option"
          aria-selected={checked}
          aria-setsize={hidden > 0 ? filtered.length : undefined}
          aria-posinset={hidden > 0 ? index + 1 : undefined}
          data-active={(highlight && index === activeIndex) || undefined}
          tabindex="-1"
          onmousemove={() => {
            // Наведение — только у ввода, который умеет наводить (см. проп).
            if (pointerHighlight) activeIndex = index
          }}
          disabled={option.disabled}
          class={cn(
            'flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent disabled:opacity-50',
            highlight && index === activeIndex && 'bg-accent',
          )}
          onclick={() => choose(option)}
        >
          <span aria-hidden="true" class="flex h-4 w-4 shrink-0 items-center justify-center leading-4">
            {checked ? (multiple ? '✓' : '◉') : ''}
          </span>
          <span class="min-w-0 flex-1">
            <span>{option.label}</span>
            {#if option.hint}
              <span class="block truncate text-xs text-muted-foreground">{option.hint}</span>
            {/if}
          </span>
        </button>
      {:else}
        <p class="px-2 py-3 text-center text-sm text-muted-foreground">Ничего не найдено</p>
      {/each}
      {#if hidden > 0}
        <!--
          Строка для глаза: о неполном списке скринридеру говорят `aria-setsize`
          и `aria-posinset` на вариантах, поэтому здесь текст скрыт от него —
          иначе он же читался бы как содержимое listbox.
        -->
        <p class="px-2 py-3 text-center text-xs text-muted-foreground" data-select-more="" aria-hidden="true">
          Показано {visible.length} из {filtered.length} — листайте дальше или уточните запрос
        </p>
      {/if}
    </div>
  </div>

  {#if multiple && (config.showSelectAll || config.showClear)}
    <div
      class={cn('flex items-center justify-between gap-2 border-t border-border px-2 py-1.5 text-sm', fullscreen && 'hidden')}
      data-select-actions=""
    >
      {#if config.showSelectAll}
        <button type="button" class="rounded-md px-2 py-1 hover:bg-accent"
          onclick={() => applySelection(selectedAfterToggleAll(selected, filtered, allVisibleSelected))}>
          {allVisibleSelected ? 'Снять выделение' : query ? 'Выбрать найденные' : 'Выбрать все'}
        </button>
      {/if}
      {#if config.showClear}
        <button type="button" class="rounded-md px-2 py-1 text-muted-foreground hover:bg-accent"
          onclick={() => applySelection([])}>Очистить</button>
      {/if}
    </div>
  {/if}
</div>
