<script lang="ts">
  /**
   * Поле с кнопкой копирования своего содержимого (примитив UI): кнопка с
   * иконкой внутри поля кладёт значение в буфер обмена (`navigator.clipboard`).
   * Образец встроенной кнопки — `PasswordInput` (тот же `InputShell` +
   * `InputAffix`); сама иконка — `CopyIcon`. Без JS кнопки нет (буферу нужен
   * скрипт) — остаётся обычное выделяемое поле; поэтому `pr-10` и аффикс
   * появляются только после оживления.
   *
   * Атрибуты поля формы (`name`, `id`, `aria-*`, `readonly`) приезжают
   * через rest — их раскладка ПЕРВАЯ (см. `PasswordInput`).
   */
  import { onMount } from 'svelte'
  import type { HTMLInputAttributes } from 'svelte/elements'
  import { cn } from '../../../utils'
  import InputAffix from '../input/InputAffix.svelte'
  import InputShell from '../input/InputShell.svelte'
  import CopyIcon from '../copy-icon/CopyIcon.svelte'

  interface Props extends Omit<HTMLInputAttributes, 'size'> {
    copyLabel?: string
    copiedLabel?: string
    size?: 'sm' | 'md' | 'lg'
  }

  let {
    copyLabel = 'Копировать',
    copiedLabel = 'Скопировано',
    class: cls,
    disabled = false,
    value = $bindable(),
    size,
    ...rest
  }: Props = $props()

  let mounted = $state(false)
  let copied = $state(false)
  let timer: ReturnType<typeof setTimeout> | undefined

  onMount(() => (mounted = true))

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(String(value ?? ''))
      copied = true
      clearTimeout(timer)
      timer = setTimeout(() => (copied = false), 2000)
    } catch {
      /* браузер не дал буфер — текст остаётся выделяемым */
    }
  }

  const label = $derived(copied ? copiedLabel : copyLabel)
</script>

<InputShell data-copy-input="" class={cls}>
  <input
    {...rest}
    bind:value
    {disabled}
    class={cn(
      'w-full rounded-md border border-input bg-background text-foreground shadow-xs placeholder:text-muted-foreground transition-colors outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20',
      size === 'sm' ? 'h-8 px-2.5 text-sm' : size === 'lg' ? 'h-10 px-3 text-sm' : 'h-9 px-3 text-sm',
      mounted && 'pr-10',
    )}
  />
  {#if mounted}
    <InputAffix side="end" interactive>
      <button
        type="button"
        class="inline-flex h-full w-10 cursor-pointer items-center justify-center rounded-r-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-50"
        class:text-foreground={copied}
        aria-label={label}
        title={label}
        {disabled}
        onclick={copy}
      >
        <CopyIcon size={16} />
      </button>
    </InputAffix>
  {/if}
</InputShell>
