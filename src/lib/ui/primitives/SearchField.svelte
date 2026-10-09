<script lang="ts">
  // Поле поиска с крестиком очистки. Порт `SearchField` из `search-input.tsx`.
  import type { Snippet } from 'svelte'
  import type { ClassValue } from 'clsx'
  import { cn } from '../cn'
  import InputShell from './InputShell.svelte'
  import InputAffix from './InputAffix.svelte'

  interface Props {
    filled?: boolean
    disabled?: boolean
    clearLabel?: string
    class?: ClassValue | null
    onClear: () => void
    children?: Snippet
  }
  let {
    filled = false,
    disabled = false,
    clearLabel = 'Очистить поиск',
    class: cls,
    onClear,
    children,
  }: Props = $props()
</script>

<InputShell class={cn('flex-1', cls)} data-search-field="">
  {#if children}{@render children()}{/if}
  {#if filled && !disabled}
    <InputAffix side="end" interactive>
      <button
        type="button"
        data-search-clear=""
        class="inline-flex h-full w-9 items-center justify-center rounded-r-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/30 cursor-pointer"
        aria-label={clearLabel}
        title={clearLabel}
        onpointerdown={(e) => {
          e.preventDefault()
          onClear()
        }}
        onclick={(e) => e.preventDefault()}
      >
        <svg aria-hidden="true" viewBox="0 0 16 16" class="h-4 w-4 fill-none stroke-current stroke-2">
          <path d="m4 4 8 8m0-8-8 8" />
        </svg>
      </button>
    </InputAffix>
  {/if}
</InputShell>
