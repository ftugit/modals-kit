<script module lang="ts">
  /** Как показать оценку: отрезками или сплошной шкалой. */
  export type StrengthView = 'segments' | 'bar'
</script>

<script lang="ts">
  // Пароль со шкалой сложности = обычный PasswordInput + индикатор под ним.
  // Оценку примитив НЕ считает: её приносит приложение (в форме — `strengthOf`,
  // та же функция, что проверяет поле). Иначе шкала и проверка разойдутся:
  // «надёжный» на шкале при отказе формы.
  import type { ComponentProps } from 'svelte'
  import { cn } from '../cn'
  import PasswordInput from './PasswordInput.svelte'

  interface Props extends ComponentProps<typeof PasswordInput> {
    /** Оценка 0–4; 0 — оценивать нечего, индикатор скрыт. */
    score: number
    /** Подпись оценки рядом со шкалой («хороший · 52 бит»). */
    label?: string
    view?: StrengthView
  }

  let { score, label, view = 'segments', value = $bindable(), ...rest }: Props = $props()

  const level = $derived(Math.max(0, Math.min(4, Math.round(score))))
</script>

<PasswordInput {...rest} bind:value />
{#if level > 0}
  <!--
    Цвет — переменная `--strength-color` от `data-score`: детям не нужно знать
    все цвета. Значение в селекторе — в кавычках: без них lightningcss при
    минификации считает `[data-score=0]` ошибкой.
  -->
  <div
    class={cn(
      'mt-1.5 flex items-center gap-2',
      "data-[score='1']:[--strength-color:var(--destructive)] data-[score='2']:[--strength-color:#d97706]",
      "data-[score='3']:[--strength-color:#65a30d] data-[score='4']:[--strength-color:#16a34a]",
    )}
    data-strength=""
    data-score={level}
  >
    {#if view === 'bar'}
      <div
        class="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label="Сложность пароля"
        aria-valuenow={level * 25}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          class="h-full rounded-full bg-[var(--strength-color)] transition-[width] duration-200 motion-reduce:duration-[1ms]"
          style={`width: ${level * 25}%`}
        ></div>
      </div>
    {:else}
      <div class="flex flex-1 gap-1" aria-hidden="true">
        {#each [1, 2, 3, 4] as seg (seg)}
          <span
            class="h-1.5 flex-1 rounded-full bg-muted transition-[background-color] duration-200 motion-reduce:duration-[1ms] data-[on=true]:bg-[var(--strength-color)]"
            data-strength-seg=""
            data-on={level >= seg ? 'true' : 'false'}
          ></span>
        {/each}
      </div>
    {/if}
    {#if label}
      <span class="w-28 text-right text-xs text-muted-foreground" aria-live="polite">{label}</span>
    {/if}
  </div>
{/if}
