<script lang="ts">
  // Числовое поле с кнопками «−/+». Атрибуты (name, id, min/max/step, aria-*,
  // required) приходят снаружи как есть — поле формы разворачивает сюда `attrs`.
  // Кнопки появляются после оживления: без JS остаётся обычный `type="number"`.
  import { onMount } from 'svelte'
  import type { HTMLInputAttributes } from 'svelte/elements'
  import { cn } from '#components/utils.js'
  import Input from '../input/Input.svelte'
  import { affixButtonClass, AUTO_WIDTH_CLASS } from '../field/field'

  interface Props extends Omit<HTMLInputAttributes, 'type' | 'value' | 'size'> {
    value?: number | string | null
    decrementLabel?: string
    incrementLabel?: string
    /** Ширина по числу вместо всей строки (кнопки «−/+» остаются внутри рамки). */
    autoWidth?: boolean
    /** Наименьшая ширина при `autoWidth`, в символах (без места под кнопки). */
    minChars?: number
  }

  let {
    value = $bindable(),
    disabled = false,
    decrementLabel = 'Уменьшить',
    incrementLabel = 'Увеличить',
    autoWidth = false,
    minChars = 4,
    class: cls,
    style,
    ...rest
  }: Props = $props()

  let mounted = $state(false)
  let inputEl = $state<HTMLInputElement | null>(null)
  // элемент даёт примитив `Input` (forwarded ref, как у `Button`)
  const grab = (el: HTMLInputElement | null): void => {
    inputEl = el
  }

  onMount(() => {
    mounted = true
  })

  const bound = (raw: unknown): number | null => {
    if (raw === undefined || raw === null || raw === '') return null
    const n = Number(raw)
    return Number.isFinite(n) ? n : null
  }
  const min = $derived(bound(rest.min))
  const max = $derived(bound(rest.max))
  // `step="any"` (умолчание числового поля формы) кнопкам шага не даёт: шагаем на 1.
  const step = $derived(bound(rest.step) ?? 1)
  const current = $derived(bound(value))

  /** Знаков после запятой у шага: 0.1 + 0.2 не должно дать 0.30000000000000004. */
  const decimals = $derived((String(step).split('.')[1] ?? '').length)

  function shift(direction: 1 | -1) {
    if (disabled || !inputEl) return
    // С пустого поля «+» начинает с нижней границы, «−» — с верхней (без границ —
    // с одного шага от нуля); дальше — шаг от текущего значения.
    let next =
      current !== null ? current + direction * step
      : direction > 0 ? (min ?? step)
      : (max ?? min ?? -step)
    if (min !== null && next < min) next = min
    if (max !== null && next > max) next = max
    next = Number(next.toFixed(decimals))
    inputEl.value = String(next)
    value = next
    // Тот же путь, что у ввода с клавиатуры: обработчики потребителя видят событие.
    inputEl.dispatchEvent(new Event('input', { bubbles: true }))
    inputEl.dispatchEvent(new Event('change', { bubbles: true }))
  }
</script>

<!-- С `autoWidth` обёртка по ширине поля: кнопки позиционируются от неё и должны
     остаться внутри рамки, а не уехать к краю строки. -->
<div class={autoWidth ? 'relative inline-flex w-fit max-w-full items-center' : 'relative flex items-center'} data-number-field="">
  <!-- Чужие атрибуты — первыми: `type` поля задаёт сам примитив. Само поле —
       примитив `Input` (вид/размеры его), как у `HoldButton`; от себя — скрытые
       спиннеры webkit, место под кнопки и расширенная autoWidth-ширина. -->
  <Input
    {...rest}
    ref={grab}
    type="number"
    {disabled}
    bind:value
    class={cn(
      '[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none',
      mounted && 'pr-16',
      // Место под кнопки (pr-16) — сверх ширины самого числа; autoWidth ведём
      // сами (Input-овский min-w не знает про кнопки), класс — общий из field.ts
      autoWidth && [AUTO_WIDTH_CLASS, mounted ? 'min-w-[calc(var(--field-min-width)+4.75rem)]' : 'min-w-[calc(var(--field-min-width)+1.5rem)]'],
      cls,
    )}
    style={autoWidth ? `--field-min-width: ${minChars}ch;${style ? ` ${style}` : ''}` : style}
  />
  {#if mounted}
    <span class="absolute right-1 flex items-center gap-0.5">
      <button
        type="button"
        class={cn(affixButtonClass, 'h-7 w-7 rounded-md hover:bg-accent')}
        aria-label={decrementLabel}
        data-number-step="down"
        disabled={disabled || (current !== null && min !== null && current <= min)}
        onclick={() => shift(-1)}
      >
        <svg aria-hidden="true" viewBox="0 0 16 16" class="h-4 w-4 fill-none stroke-current stroke-2">
          <path d="M3.5 8h9" />
        </svg>
      </button>
      <button
        type="button"
        class={cn(affixButtonClass, 'h-7 w-7 rounded-md hover:bg-accent')}
        aria-label={incrementLabel}
        data-number-step="up"
        disabled={disabled || (current !== null && max !== null && current >= max)}
        onclick={() => shift(1)}
      >
        <svg aria-hidden="true" viewBox="0 0 16 16" class="h-4 w-4 fill-none stroke-current stroke-2">
          <path d="M8 3.5v9M3.5 8h9" />
        </svg>
      </button>
    </span>
  {/if}
</div>
