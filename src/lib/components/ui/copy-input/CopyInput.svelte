<script lang="ts">
  /**
   * Поле с кнопкой копирования своего содержимого (примитив UI): кнопка с
   * иконкой внутри поля кладёт значение в буфер обмена (`navigator.clipboard`).
   * Композиция как у `HoldButton`: внутри — примитив `Input` (вид, размеры и
   * `aria-invalid` — его, никаких скопированных классов), вокруг — `InputShell`
   * + `InputAffix`; иконка рядом (`CopyIcon.svelte`), как `PasswordStrength`
   * у `password/`. Без JS кнопки нет (буферу нужен скрипт) — остаётся обычное
   * выделяемое поле, поэтому `pr-10` и аффикс появляются после оживления.
   *
   * Атрибуты поля формы (`name`, `id`, `aria-*`, `readonly`) приезжают через
   * rest; явные атрибуты ПОСЛЕ spread перекрывают его (см. `PasswordInput`).
   */
  import { onMount } from 'svelte'
  import type { HTMLInputAttributes } from 'svelte/elements'
  import { cn } from '../../../utils'
  import Input from '../input/Input.svelte'
  import InputAffix from '../input/InputAffix.svelte'
  import InputShell from '../input/InputShell.svelte'
  import CopyIcon from './CopyIcon.svelte'

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
  <Input
    {...rest}
    bind:value
    {disabled}
    {size}
    class={cn(mounted && 'pr-10')}
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
