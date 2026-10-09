<script lang="ts">
  import { onMount } from 'svelte'
  import { cn } from '../cn'

  interface Props {
    min?: number
    max?: number
    step?: number
    value?: number
    disabled?: boolean
    class?: string
    name?: string
  }

  let {
    min = 0,
    max = 20,
    step = 1,
    value = $bindable(3),
    disabled = false,
    class: cls,
    name = 'demo-number',
  }: Props = $props()

  let mounted = $state(false)

  onMount(() => {
    mounted = true
  })

  function stepUp() {
    if (disabled) return
    const next = (value ?? 0) + step
    if (next <= max) value = next
  }

  function stepDown() {
    if (disabled) return
    const next = (value ?? 0) - step
    if (next >= min) value = next
  }
</script>

<div class="relative flex items-center">
  <input
    type="number"
    {name}
    inputmode="numeric"
    {min}
    {max}
    {step}
    {disabled}
    bind:value
    class={cn(
      'h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none',
      mounted && 'pr-16',
      cls,
    )}
  />
  {#if mounted}
    <span class="absolute right-1 flex items-center gap-0.5">
      <button
        type="button"
        class="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50 cursor-pointer"
        aria-label="Уменьшить"
        disabled={disabled || (value ?? 0) <= min}
        onclick={stepDown}
      >
        <svg aria-hidden="true" viewBox="0 0 16 16" class="h-4 w-4 fill-none stroke-current stroke-2">
          <path d="M3.5 8h9" />
        </svg>
      </button>
      <button
        type="button"
        class="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50 cursor-pointer"
        aria-label="Увеличить"
        disabled={disabled || (value ?? 0) >= max}
        onclick={stepUp}
      >
        <svg aria-hidden="true" viewBox="0 0 16 16" class="h-4 w-4 fill-none stroke-current stroke-2">
          <path d="M8 3.5v9M3.5 8h9" />
        </svg>
      </button>
    </span>
  {/if}
</div>
