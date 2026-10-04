<script lang="ts">
  import { onMount } from 'svelte'
  import { cn } from '../cn'
  import InputAffix from './InputAffix.svelte'

  interface Props {
    disabled?: boolean
    class?: string
    direction?: 'left' | 'right'
    value?: string
    onSearch?: (val: string) => void
  }

  let {
    disabled = false,
    class: cls,
    direction = 'left',
    value = $bindable(''),
    onSearch,
  }: Props = $props()

  const id = `search-morph-${Math.random().toString(36).slice(2, 9)}`
  let open = $state(false)
  let rootEl = $state<HTMLDivElement | null>(null)
  let fieldEl = $state<HTMLInputElement | null>(null)

  function collapseIfEmpty(event: PointerEvent) {
    if (!open || rootEl?.contains(event.target as Node)) return
    if (value.trim()) return
    open = false
  }

  onMount(() => {
    document.addEventListener('pointerdown', collapseIfEmpty, true)
    return () => document.removeEventListener('pointerdown', collapseIfEmpty, true)
  })

  function expand() {
    open = true
    requestAnimationFrame(() => {
      if (!fieldEl) return
      fieldEl.focus({ preventScroll: true })
      if (rootEl) rootEl.scrollLeft = 0
    })
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      value = ''
      open = false
    } else if (e.key === 'Enter') {
      onSearch?.(value)
    }
  }
</script>

<div
  bind:this={rootEl}
  class={cn('flex', direction === 'left' ? 'justify-end' : 'justify-start', cls)}
>
  <input
    type="checkbox"
    {id}
    class="search-morph-toggle peer sr-only"
    checked={open}
    {disabled}
    onchange={(e) => (e.currentTarget.checked ? expand() : (open = false))}
  />
  <div
    class="search-morph relative flex h-9 items-center rounded-md border border-input bg-background shadow-xs focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30"
    data-open={open ? 'true' : 'false'}
    data-testid="search-morph"
  >
    <div class="search-morph-field h-full">
      <input
        bind:this={fieldEl}
        bind:value
        type="search"
        {disabled}
        placeholder="Что ищем?"
        aria-label="Поиск"
        tabindex={open ? 0 : -1}
        class={cn(
          'h-full w-full min-w-0 rounded-md bg-transparent text-sm outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:appearance-none',
          direction === 'left' ? 'pl-3 pr-9' : 'pl-9 pr-3',
        )}
        onkeydown={handleKeydown}
      />
    </div>
    <InputAffix side={direction === 'left' ? 'end' : 'start'} interactive class="w-9">
      <label
        data-morph="open"
        for={id}
        class="inline-flex h-full w-9 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
        aria-label="Открыть поиск"
      >
        <svg aria-hidden="true" viewBox="0 0 16 16" class="h-4 w-4 fill-none stroke-current stroke-2">
          <circle cx="7" cy="7" r="4.5" />
          <path d="m10.5 10.5 4 4" />
        </svg>
      </label>
      <button
        data-morph="submit"
        type="button"
        class="inline-flex h-full w-9 items-center justify-center rounded-md text-muted-foreground hover:text-foreground cursor-pointer"
        aria-label="Искать"
        tabindex={open ? 0 : -1}
        onclick={() => onSearch?.(value)}
      >
        <svg aria-hidden="true" viewBox="0 0 16 16" class="h-4 w-4 fill-none stroke-current stroke-2">
          <circle cx="7" cy="7" r="4.5" />
          <path d="m10.5 10.5 4 4" />
        </svg>
      </button>
    </InputAffix>
  </div>
</div>
