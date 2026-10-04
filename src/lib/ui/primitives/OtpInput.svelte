<script lang="ts">
  import { onMount } from 'svelte'
  import { cn } from '../cn'

  interface Props {
    length?: number
    value?: string
    disabled?: boolean
    class?: string
    onComplete?: (code: string) => void
  }

  let {
    length = 6,
    value = $bindable(''),
    disabled = false,
    class: cls,
    onComplete,
  }: Props = $props()

  let mounted = $state(false)
  let focused = $state(false)
  let caret = $state(0)
  let fieldEl = $state<HTMLInputElement | null>(null)

  const done = $derived(value.length === length)
  const activeIndex = $derived(Math.min(focused ? caret : -1, length - 1))

  function digits(raw: string) {
    return raw.replace(/\D/g, '').slice(0, length)
  }

  function handleInput(e: Event & { currentTarget: HTMLInputElement }) {
    const next = digits(e.currentTarget.value)
    value = next
    if (e.currentTarget.value !== next) e.currentTarget.value = next
    caret = e.currentTarget.selectionStart ?? next.length
    if (next.length === length) onComplete?.(next)
  }

  function syncCaret() {
    caret = fieldEl?.selectionStart ?? value.length
  }

  onMount(() => {
    mounted = true
  })
</script>

<div class={cn('flex flex-col items-start gap-1.5', cls)}>
  {#if !mounted}
    <input
      type="text"
      inputmode="numeric"
      autocomplete="one-time-code"
      pattern={`\\d{${length}}`}
      title={`Ровно ${length} цифр`}
      maxlength={length}
      {disabled}
      aria-label={`Код из ${length} цифр`}
      data-testid="otp-input"
      class="otp-plain rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
      {value}
      oninput={handleInput}
    />
  {:else}
    <div class="otp" data-testid="otp">
      {#each Array.from({ length }) as _, index}
        <span
          class="otp-slot"
          data-active={activeIndex === index ? 'true' : 'false'}
          data-empty={value[index] ? 'false' : 'true'}
          aria-hidden="true"
        >
          {value[index] ?? ''}
        </span>
      {/each}
      <input
        bind:this={fieldEl}
        type="text"
        inputmode="numeric"
        autocomplete="one-time-code"
        pattern={`\\d{${length}}`}
        title={`Ровно ${length} цифр`}
        maxlength={length}
        {disabled}
        aria-label={`Код из ${length} цифр`}
        data-testid="otp-input"
        class="otp-input"
        {value}
        oninput={handleInput}
        onfocus={() => {
          focused = true
          syncCaret()
        }}
        onblur={() => (focused = false)}
        onkeyup={syncCaret}
        onclick={syncCaret}
      />
    </div>
  {/if}
  <p class="text-xs text-muted-foreground">
    {#if !mounted}
      Ровно {length} цифр.
    {:else if done}
      Код введён полностью.
    {:else}
      Введено {value.length} из {length}.
    {/if}
  </p>
</div>
