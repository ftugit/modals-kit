<script lang="ts">
  import { onMount } from 'svelte'
  import type { HTMLInputAttributes } from 'svelte/elements'
  import { cn } from '../../../utils'
  import { affixButtonClass } from '../field/field'
  import Input from '../input/Input.svelte'
  import InputAffix from '../input/InputAffix.svelte'
  import InputShell from '../input/InputShell.svelte'

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
  // элемент даёт примитив `Input` (forwarded ref, как у `Button`)
  const grab = (el: HTMLInputElement | null): void => {
    inputEl = el
  }

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
  <!-- Чужие атрибуты — ПЕРВЫМИ: поле формы приносит `type="password"` в attrs;
       явный type ПОСЛЕ spread его перекрывает (то же на границе компонента).
       Само поле — примитив `Input` (вид/размеры его), как у `HoldButton`. -->
  <Input
    {...rest}
    ref={grab}
    bind:value
    type={visible ? 'text' : 'password'}
    {disabled}
    {size}
    class={cn(mounted && 'pr-10')}
  />
  {#if mounted}
    <InputAffix side="end" interactive>
      <button
        type="button"
        class={cn(affixButtonClass, 'h-full w-10 rounded-r-md')}
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
