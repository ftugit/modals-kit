<script lang="ts">
  // Одноразовый код: до оживления — обычное поле (жив без JS), после — ячейки
  // поверх того же поля. Атрибуты (name, id, required, pattern, aria-*) приходят
  // снаружи как есть — поле формы разворачивает сюда `attrs`.
  import { onMount } from 'svelte'
  import type { ClassValue, HTMLInputAttributes } from 'svelte/elements'
  import { cn } from '../../../utils'

  interface Props extends Omit<HTMLInputAttributes, 'type' | 'value' | 'size' | 'class'> {
    length?: number
    value?: string
    /** Классы самого контрола (поля до оживления / ячеек после оживления). */
    class?: ClassValue | null
    /** Классы внешней обёртки. */
    wrapperClass?: ClassValue | null
    onComplete?: (code: string) => void
  }

  let {
    length = 6,
    value = $bindable(''),
    disabled = false,
    class: cls,
    wrapperClass,
    onComplete,
    oninput,
    ...rest
  }: Props = $props()

  let mounted = $state(false)
  let focused = $state(false)
  let caret = $state(0)
  let fieldEl = $state<HTMLInputElement | null>(null)

  const text = $derived(String(value ?? ''))
  const done = $derived(text.length === length)
  const activeIndex = $derived(Math.min(focused ? caret : -1, length - 1))
  const invalid = $derived(rest['aria-invalid'] === true || rest['aria-invalid'] === 'true')

  /**
   * Свои значения — только там, где снаружи ничего не пришло: подпись поля
   * формы (`<label for>`) сильнее `aria-label`, а правило формы — шаблона.
   */
  const own = $derived({
    pattern: rest.pattern ?? `\\d{${length}}`,
    maxlength: rest.maxlength ?? length,
    title: rest.title ?? `Ровно ${length} цифр`,
    'aria-label': rest.id || rest['aria-labelledby'] ? rest['aria-label'] : (rest['aria-label'] ?? `Код из ${length} цифр`),
  })

  function digits(raw: string) {
    return raw.replace(/\D/g, '').slice(0, length)
  }

  function handleInput(e: Event & { currentTarget: EventTarget & HTMLInputElement }) {
    const next = digits(e.currentTarget.value)
    value = next
    if (e.currentTarget.value !== next) e.currentTarget.value = next
    caret = e.currentTarget.selectionStart ?? next.length
    oninput?.(e)
    if (next.length === length) onComplete?.(next)
  }

  function syncCaret() {
    caret = fieldEl?.selectionStart ?? text.length
  }

  onMount(() => {
    mounted = true
  })
</script>

<div class={cn('flex flex-col items-start gap-1.5', wrapperClass)}>
  {#if !mounted}
    <input
      {...rest}
      {...own}
      type="text"
      inputmode="numeric"
      autocomplete="one-time-code"
      {disabled}
      data-testid="otp-input"
      data-otp-input=""
      class={cn(
        'w-full max-w-[16rem] rounded-md border border-input bg-background px-3 py-2 text-center font-mono text-base tracking-[0.35em] indent-[0.35em] text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20',
        cls,
      )}
      value={text}
      oninput={handleInput}
    />
  {:else}
    <div class="relative inline-flex w-max gap-1.5" data-testid="otp" data-otp="">
      {#each Array.from({ length }) as _, index}
        <span
          class={cn(
            'grid size-9 place-items-center rounded-md border border-input bg-background font-mono text-[0.9375rem] text-foreground',
            'transition-[border-color,box-shadow] duration-150 ease-[ease] motion-reduce:duration-[1ms]',
            'data-[invalid=true]:border-destructive data-[invalid=true]:ring-2 data-[invalid=true]:ring-destructive/20',
            'data-[active=true]:border-ring data-[active=true]:shadow-[0_0_0_2px_color-mix(in_oklab,var(--ring)_30%,transparent)]',
            "data-[active=true]:data-[empty=true]:after:h-[1.1em] data-[active=true]:data-[empty=true]:after:w-px data-[active=true]:data-[empty=true]:after:bg-foreground data-[active=true]:data-[empty=true]:after:content-['']",
            'data-[active=true]:data-[empty=true]:after:animate-flash',
            'data-[active=true]:data-[empty=true]:after:animate-[flash_2s_linear_infinite]!',
            'motion-reduce:data-[active=true]:data-[empty=true]:after:animate-none!',
            cls,
          )}
          data-otp-slot=""
          data-invalid={invalid ? 'true' : undefined}
          data-active={activeIndex === index ? 'true' : 'false'}
          data-empty={text[index] ? 'false' : 'true'}
          aria-hidden="true"
        >
          {text[index] ?? ''}
        </span>
      {/each}
      <input
        {...rest}
        {...own}
        bind:this={fieldEl}
        type="text"
        inputmode="numeric"
        autocomplete="one-time-code"
        {disabled}
        data-testid="otp-input"
        data-otp-input-overlay=""
        class="absolute inset-0 size-full border-0 bg-transparent p-0 text-base tracking-normal text-transparent caret-transparent outline-none [&::selection]:bg-transparent"
        value={text}
        oninput={handleInput}
        onfocus={() => {
          focused = true
          syncCaret()
        }}
        onblur={(e) => {
          focused = false
          rest.onblur?.(e)
        }}
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
      Введено {text.length} из {length}.
    {/if}
  </p>
</div>
