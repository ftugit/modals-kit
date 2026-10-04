<script lang="ts">
  import { onMount } from 'svelte'
  import type { HTMLInputAttributes } from 'svelte/elements'
  import { cn } from '../cn'
  import SearchField from './SearchField.svelte'

  interface Props extends Omit<HTMLInputAttributes, 'type' | 'value'> {
    value?: string
    clearLabel?: string
    onClear?: () => void
  }

  let {
    value = $bindable(''),
    clearLabel = 'Очистить поиск',
    class: cls,
    disabled = false,
    onClear,
    ...rest
  }: Props = $props()

  let inputEl = $state<HTMLInputElement | null>(null)
  let mounted = $state(false)
  let filled = $derived(Boolean(value && value.length > 0))

  function clear() {
    value = ''
    if (inputEl) {
      inputEl.value = ''
      inputEl.dispatchEvent(new Event('input', { bubbles: true }))
      inputEl.focus({ preventScroll: true })
    }
    onClear?.()
  }

  onMount(() => {
    mounted = true
    const onReset = () => {
      value = ''
    }
    inputEl?.form?.addEventListener('reset', onReset)
    return () => inputEl?.form?.removeEventListener('reset', onReset)
  })
</script>

<SearchField
  {filled}
  onClear={clear}
  {clearLabel}
  disabled={!mounted || Boolean(disabled)}
  class={cls}
>
  <input
    bind:this={inputEl}
    bind:value
    type="search"
    {disabled}
    class={cn(
      'w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-xs placeholder:text-muted-foreground transition-colors outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50 pr-9 [&::-webkit-search-cancel-button]:appearance-none',
      cls,
    )}
    {...rest}
  />
</SearchField>
