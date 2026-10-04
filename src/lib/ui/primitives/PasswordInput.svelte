<script lang="ts">
  import { onMount } from 'svelte'
  import type { HTMLInputAttributes } from 'svelte/elements'
  import { cn } from '../cn'
  import InputAffix from './InputAffix.svelte'
  import InputShell from './InputShell.svelte'

  interface Props extends Omit<HTMLInputAttributes, 'type' | 'size'> {
    showLabel?: string
    hideLabel?: string
    size?: 'sm' | 'md' | 'lg'
  }

  let {
    showLabel = 'Показать пароль',
    hideLabel = 'Скрыть пароль',
    class: cls,
    disabled = false,
    value = $bindable(),
    size,
    ...rest
  }: Props = $props()

  let mounted = $state(false)
  let visible = $state(false)
  let inputEl = $state<HTMLInputElement | null>(null)

  function toggle() {
    if (!inputEl) return
    const start = inputEl.selectionStart
    const end = inputEl.selectionEnd
    visible = !visible
    queueMicrotask(() => {
      inputEl?.focus({ preventScroll: true })
      if (start !== null && end !== null) inputEl?.setSelectionRange(start, end)
    })
  }

  onMount(() => {
    mounted = true
    const onReset = () => {
      visible = false
    }
    inputEl?.form?.addEventListener('reset', onReset)
    return () => inputEl?.form?.removeEventListener('reset', onReset)
  })

  const label = $derived(visible ? hideLabel : showLabel)
</script>

<InputShell data-password-input="" class={cls}>
  <input
    bind:this={inputEl}
    bind:value
    type={visible ? 'text' : 'password'}
    {disabled}
    class={cn(
      'w-full rounded-md border border-input bg-background text-foreground shadow-xs placeholder:text-muted-foreground transition-colors outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20',
      size === 'sm' ? 'h-8 px-2.5 text-sm' : size === 'lg' ? 'h-10 px-3 text-sm' : 'h-9 px-3 text-sm',
      mounted && 'pr-10',
    )}
    {...rest}
  />
  {#if mounted}
    <InputAffix side="end" interactive>
      <button
        type="button"
        class="inline-flex h-full w-10 items-center justify-center rounded-r-md hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-50 cursor-pointer text-muted-foreground"
        aria-label={label}
        aria-pressed={visible}
        title={label}
        {disabled}
        onclick={toggle}
      >
        {#if visible}
          <svg aria-hidden="true" viewBox="0 0 20 20" class="h-4 w-4 fill-none stroke-current stroke-2">
            <path d="m3 3 14 14M8.3 5.3A8 8 0 0 1 10 5c5 0 8 5 8 5a12 12 0 0 1-2.1 2.7M12.4 14.6A8 8 0 0 1 10 15c-5 0-8-5-8-5a12.5 12.5 0 0 1 3-3.4" />
            <path d="M8.2 8.2a2.5 2.5 0 0 0 3.6 3.6" />
          </svg>
        {:else}
          <svg aria-hidden="true" viewBox="0 0 20 20" class="h-4 w-4 fill-none stroke-current stroke-2">
            <path d="M2 10s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5Z" />
            <circle cx="10" cy="10" r="2.5" />
          </svg>
        {/if}
      </button>
    </InputAffix>
  {/if}
</InputShell>
