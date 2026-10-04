<script module lang="ts">
  export type StrengthView = 'text' | 'color' | 'segments' | 'bar' | 'all'

  const LEVELS = ['Слишком простой', 'Слабый', 'Средний', 'Хороший', 'Надёжный']

  export function scorePassword(val: string): number {
    if (!val) return 0
    const pool =
      (/[a-z]/.test(val) ? 26 : 0) +
      (/[A-Z]/.test(val) ? 26 : 0) +
      (/[а-я]/.test(val) ? 33 : 0) +
      (/[А-Я]/.test(val) ? 33 : 0) +
      (/\d/.test(val) ? 10 : 0) +
      (/[^\da-zA-Zа-яА-Я]/.test(val) ? 32 : 0)
    if (!pool) return 0
    const bits = val.length * Math.log2(pool)
    if (bits < 28) return 1
    if (bits < 40) return 2
    if (bits < 60) return 3
    return 4
  }
</script>

<script lang="ts">
  import { onMount } from 'svelte'
  import { cn } from '../cn'
  import InputShell from './InputShell.svelte'
  import InputAffix from './InputAffix.svelte'

  interface Props {
    view?: StrengthView
    disabled?: boolean
    value?: string
    placeholder?: string
  }

  let {
    view = 'all',
    disabled = false,
    value = $bindable(''),
    placeholder = 'Придумайте пароль',
  }: Props = $props()

  let mounted = $state(false)
  let visible = $state(false)

  const score = $derived(scorePassword(value))
  const show = (kind: StrengthView) => mounted && (view === 'all' || view === kind)

  onMount(() => {
    mounted = true
  })
</script>

<div class="strength flex flex-col gap-2" data-score={score} data-testid="strength">
  <InputShell>
    <input
      type={visible ? 'text' : 'password'}
      {placeholder}
      autocomplete="new-password"
      {disabled}
      aria-describedby="strength-hint"
      class={cn(
        'w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50',
        mounted && 'pr-10',
        show('color') &&
          value &&
          'border-[var(--strength-color)] focus-visible:border-[var(--strength-color)]',
      )}
      bind:value
    />
    {#if mounted}
      <InputAffix side="end" interactive class="w-10">
        <button
          type="button"
          class="inline-flex h-full w-10 items-center justify-center rounded-r-md text-muted-foreground hover:text-foreground cursor-pointer"
          aria-label={visible ? 'Скрыть пароль' : 'Показать пароль'}
          aria-pressed={visible}
          onclick={() => (visible = !visible)}
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

  {#if show('segments')}
    <div class="flex gap-1" aria-hidden="true">
      {#each [1, 2, 3, 4] as level}
        <span
          class="strength-seg h-1.5 flex-1 rounded-full"
          data-on={score >= level ? 'true' : 'false'}
        ></span>
      {/each}
    </div>
  {/if}

  {#if show('bar')}
    <div class="flex flex-col gap-1" role="progressbar" aria-valuenow={score * 25} aria-valuemin={0} aria-valuemax={100}>
      <div class="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          class="strength-bar h-full rounded-full transition-all duration-200"
          style={`width: ${score * 25}%`}
        ></div>
      </div>
      <span class="sr-only">Сложность пароля</span>
    </div>
  {/if}

  <p
    id="strength-hint"
    class={cn('text-xs', show('text') ? 'strength-text' : 'text-muted-foreground')}
    aria-live="polite"
  >
    {#if mounted && value}
      {show('text') ? LEVELS[score] : `Оценка: ${score} из 4`}
    {:else}
      Минимум 8 символов, лучше — разные регистры, цифры и знаки.
    {/if}
  </p>
</div>
