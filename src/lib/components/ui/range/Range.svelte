<script lang="ts">
  // Ползунок (`Range` / `Slider`) — по эталону shadcn/ui v4 (`ui/slider.tsx`):
  // тонкий трек `h-1.5 rounded-full bg-muted`, активное заполнение `bg-primary`
  // и круглый бегунок `size-4 border-primary bg-background shadow-sm` с кольцом
  // `ring-4 ring-ring/50` при наведении и фокусе. Внутри — настоящий `<input type="range">`,
  // поэтому клавиатура, скринридер, `FormData` и отправка без JS работают нативно.
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
      '[&::-webkit-slider-runnable-track]:h-1.5 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-transparent',
      '[&::-webkit-slider-thumb]:-mt-[5px] [&::-webkit-slider-thumb]:block [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-primary [&::-webkit-slider-thumb]:bg-background [&::-webkit-slider-thumb]:shadow-sm [&::-webkit-slider-thumb]:transition-[color,box-shadow] hover:[&::-webkit-slider-thumb]:ring-4 hover:[&::-webkit-slider-thumb]:ring-ring/50 focus-visible:[&::-webkit-slider-thumb]:ring-4 focus-visible:[&::-webkit-slider-thumb]:ring-ring/50',
      '[&::-moz-range-track]:h-1.5 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-transparent',
      '[&::-moz-range-thumb]:block [&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border [&::-moz-range-thumb]:border-primary [&::-moz-range-thumb]:bg-background [&::-moz-range-thumb]:shadow-sm [&::-moz-range-thumb]:transition-[color,box-shadow] hover:[&::-moz-range-thumb]:ring-4 hover:[&::-moz-range-thumb]:ring-ring/50 focus-visible:[&::-moz-range-thumb]:ring-4 focus-visible:[&::-moz-range-thumb]:ring-ring/50',
      cls,
    )}
  />
</div>
