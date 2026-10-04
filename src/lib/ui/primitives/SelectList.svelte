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
    listWidth?: 'trigger' | 'auto'
    commit: (next: readonly SelectOption[]) => void
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
    listWidth = 'trigger',
    commit,
    close,
  }: Props = $props()

  let searchInput = $state<HTMLInputElement | null>(null)
  let searchArmed = $state(false)
  let activeIndex = $state(0)
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
  const allVisibleSelected = $derived.by(() => {
    const enabled = filtered.filter((o) => !o.disabled)
    return enabled.length > 0 && enabled.every((o) => selectedValues.has(o.value))
  })

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
    void query
    void options
    if (activeIndex >= filtered.length) activeIndex = Math.max(0, filtered.length - 1)
  })

  /*
   * Браузер сам НЕ скроллит к элементу, на который указывает
   * aria-activedescendant, — в отличие от настоящего фокуса. Делаем руками,
   * иначе активная опция уезжает за край списка при навигации стрелками.
   */
  $effect(() => {
    const id = activeOptionId
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
      moveActive(1)
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      event.stopPropagation()
      moveActive(-1)
      return
    }
    if (event.key === 'Home') {
      event.preventDefault()
      event.stopPropagation()
      activeIndex = Math.max(0, filtered.findIndex((o) => !o.disabled))
      return
    }
    if (event.key === 'End') {
      event.preventDefault()
      event.stopPropagation()
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
  function applySelection(next: readonly SelectOption[]) {
    commit(next)
    if (config.clearSearchOnSelect) query = ''
  }

  function choose(option: SelectOption) {
    if (option.disabled) return
    applySelection(multiple ? selectedAfterToggle(selected, option, true) : [option])
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
    'select-content z-70 flex flex-col overflow-hidden border border-border bg-popover text-popover-foreground shadow-md outline-none',
    listWidth === 'auto' && 'select-content-auto',
  )}
  style="--select-list-height: {listHeight}"
>
  <div class="select-search-row flex items-center gap-2 border-b border-border">
    {#if config.showCount && multiple && selected.length > 0}
      <button
        type="button"
        class="select-mobile-count h-9 shrink-0 items-center gap-1.5 rounded-md px-2 text-sm font-medium hover:bg-accent"
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
        class="select-mobile-action h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
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
        class="select-mobile-action h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
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
      class="select-mobile-close h-9 w-9 items-center justify-center rounded-md hover:bg-accent"
      aria-label="Закрыть"
      onclick={close}
    >
      <svg aria-hidden="true" viewBox="0 0 16 16" class="h-4 w-4 fill-none stroke-current stroke-2">
        <path d="m4 4 8 8m0-8-8 8" />
      </svg>
    </button>
  </div>

  {#if config.showCount && multiple}
    <p class="select-count-row border-b border-border px-3 py-2 text-xs text-muted-foreground">
      Выбрано {selected.length} из {all.filter((o) => !o.disabled).length}
    </p>
  {/if}

  <div class="min-h-0 flex-1 overflow-hidden">
    <div
      bind:this={listboxEl}
      id={listboxId}
      data-select-listbox=""
      role="listbox"
      aria-multiselectable={multiple || undefined}
      class="select-listbox h-full overflow-y-auto p-1 outline-none"
      tabindex="-1"
    >
      {#each filtered as option, index (option.value)}
        {@const checked = selectedValues.has(option.value)}
        <button
          type="button"
          id={optionId(index)}
          role="option"
          aria-selected={checked}
          data-active={index === activeIndex || undefined}
          tabindex="-1"
          onmousemove={() => (activeIndex = index)}
          disabled={option.disabled}
          class={cn(
            'flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent disabled:opacity-50',
            index === activeIndex && 'bg-accent',
          )}
          onclick={() => choose(option)}
        >
          <span class={cn('w-4 shrink-0', !checked && 'opacity-0')}>
            <svg aria-hidden="true" viewBox="0 0 16 16" class="h-4 w-4 fill-none stroke-current stroke-2">
              <path d="m3 8 3 3 7-7" />
            </svg>
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
    </div>
  </div>

  {#if multiple && (config.showSelectAll || config.showClear)}
    <div class="select-actions flex items-center justify-between gap-2 border-t border-border px-2 py-1.5 text-sm">
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
