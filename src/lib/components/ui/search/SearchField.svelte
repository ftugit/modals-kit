<script lang="ts">
  // Поле поиска с крестиком очистки. Порт `SearchField` из `search-input.tsx`.
  import type { Snippet } from 'svelte'
  import type { ClassValue } from 'clsx'
  import { cn } from '../../../utils'
  import CloseIcon from '../close-icon/CloseIcon.svelte'
  import { affixButtonClass } from '../field/field'
  import InputShell from '../input/InputShell.svelte'
  import InputAffix from '../input/InputAffix.svelte'

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
        class={cn(affixButtonClass, 'h-full w-9 rounded-r-md')}
        aria-label={clearLabel}
        title={clearLabel}
        {disabled}
        onpointerdown={(e) => {
          e.preventDefault()
          onClear()
        }}
        onclick={(e) => e.preventDefault()}
      >
        <CloseIcon size={16} />
      </button>
    </InputAffix>
  {/if}
</InputShell>
