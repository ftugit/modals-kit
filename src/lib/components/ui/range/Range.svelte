<script lang="ts">
  // Ползунок (`Range` / `Slider`) — по эталону shadcn/ui v4 (`ui/slider.tsx`):
  // тонкий трек `h-1.5 rounded-full bg-muted`, активное заполнение `bg-primary`
  // и круглый бегунок `size-4 border-primary bg-background shadow-sm` с кольцом
  // `ring-4 ring-ring/50` при наведении и фокусе. Внутри — настоящий `<input type="range">`,
  // поэтому клавиатура, скринридер, `FormData` и отправка без JS работают нативно.
  //
  // Важно: вендорные псевдоэлементы WebKit и Gecko обязаны жить в отдельных CSS-правилах
  // блока стилей: склейка селекторов разных движков через запятую делает правило невалидным.
  import type { ClassValue, HTMLInputAttributes } from 'svelte/elements'
  import { cn } from '../../../utils'

  interface Props extends Omit<HTMLInputAttributes, 'type' | 'size' | 'class'> {
    value?: number | string | null
    /** Классы самого `<input type="range">`. */
    class?: ClassValue | null
    /** Классы внешней обёртки трека. */
    wrapperClass?: ClassValue | null
  }

  let {
    value = $bindable(),
    min = 0,
    max = 100,
    step,
    disabled = false,
    class: cls,
    wrapperClass,
    ...rest
  }: Props = $props()

  const minNum = $derived(Number.isFinite(Number(min)) ? Number(min) : 0)
  const maxNum = $derived(Number.isFinite(Number(max)) ? Number(max) : 100)
  const currentNum = $derived.by(() => {
    const n = Number(value)
    if (!Number.isFinite(n)) return minNum
    return Math.min(maxNum, Math.max(minNum, n))
  })
  const percent = $derived(maxNum > minNum ? ((currentNum - minNum) / (maxNum - minNum)) * 100 : 0)
</script>

<div
  data-slot="slider"
  data-disabled={disabled ? 'true' : undefined}
  class={cn('relative flex h-5 w-full touch-none items-center select-none data-[disabled=true]:opacity-50', wrapperClass)}
>
  <span
    aria-hidden="true"
    data-slot="slider-track"
    class="pointer-events-none relative h-1.5 w-full grow overflow-hidden rounded-full bg-muted"
  >
    <span
      data-slot="slider-range"
      class="block h-full bg-primary"
      style={`width: ${percent}%`}
    ></span>
  </span>

  <input
    {...rest}
    type="range"
    {min}
    {max}
    {step}
    {disabled}
    bind:value
    class={cn(
      'absolute inset-0 h-full w-full cursor-pointer appearance-none bg-transparent outline-none disabled:cursor-not-allowed',
      cls,
    )}
  />
</div>

<style>
  input::-webkit-slider-runnable-track {
    height: 0.375rem;
    border-radius: 9999px;
    background: transparent;
  }

  input::-moz-range-track {
    height: 0.375rem;
    border-radius: 9999px;
    background: transparent;
  }

  input::-webkit-slider-thumb {
    appearance: none;
    display: block;
    margin-top: -5px;
    width: 1rem;
    height: 1rem;
    border-radius: 9999px;
    border: 1px solid var(--primary);
    background-color: var(--background);
    box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05);
    transition: color 150ms, box-shadow 150ms;
  }

  input:hover:not(:disabled)::-webkit-slider-thumb,
  input:focus-visible::-webkit-slider-thumb {
    box-shadow: 0 0 0 4px color-mix(in oklab, var(--ring) 50%, transparent);
  }

  input::-moz-range-thumb {
    appearance: none;
    display: block;
    box-sizing: border-box;
    width: 1rem;
    height: 1rem;
    border-radius: 9999px;
    border: 1px solid var(--primary);
    background-color: var(--background);
    box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05);
    transition: color 150ms, box-shadow 150ms;
  }

  input:hover:not(:disabled)::-moz-range-thumb,
  input:focus-visible::-moz-range-thumb {
    box-shadow: 0 0 0 4px color-mix(in oklab, var(--ring) 50%, transparent);
  }
</style>
