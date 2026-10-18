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
   * Состояния иконки (решение владельца, ход 261): скопировано — «выполнено»
   * (`CheckIcon`), браузер отказал в буфере — «восклицание» (`WarningIcon`);
   * обе держатся 5 секунд и возвращаются к «копировать», в это время кнопка
   * не нажимается. Смена — только по фактическому результату записи в буфер.
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
  import WarningIcon from '../warning-icon/WarningIcon.svelte'
  import CopyIcon from './CopyIcon.svelte'
  import CheckIcon from './CheckIcon.svelte'

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

  /** Сколько держать состояние после попытки копирования, мс. */
  const HOLD_MS = 5000

  let mounted = $state(false)
  let done = $state<'idle' | 'copied' | 'failed'>('idle')
  let timer: ReturnType<typeof setTimeout> | undefined

  onMount(() => (mounted = true))

  /** Читается функцией: после guard TS сужает тип и отказывает в присваивании. */
  function busy(): boolean {
    return done !== 'idle'
  }

  async function copy(): Promise<void> {
    if (busy()) return // в активном состоянии кнопка не нажимается
    let ok = false
    try {
      await navigator.clipboard.writeText(String(value ?? ''))
      ok = true
    } catch {
      ok = false // браузер не дал буфер — текст остаётся выделяемым
    }
    done = ok ? 'copied' : 'failed'
    clearTimeout(timer)
    timer = setTimeout(() => (done = 'idle'), HOLD_MS)
  }

  const label = $derived(
    done === 'copied' ? copiedLabel : done === 'failed' ? 'Не удалось скопировать' : copyLabel,
  )
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
        class:text-foreground={done !== 'idle'}
        aria-label={label}
        title={label}
        disabled={disabled || done !== 'idle'}
        onclick={copy}
      >
        {#if done === 'copied'}
          <CheckIcon size={16} />
        {:else if done === 'failed'}
          <WarningIcon size={16} />
        {:else}
          <CopyIcon size={16} />
        {/if}
      </button>
    </InputAffix>
  {/if}
</InputShell>
