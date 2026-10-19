<script lang="ts">
  /**
   * Ссылка на шаг — вся сантехника из хоста: `href` (fallback без JS — честный
   * адрес), перехват клика по режиму (url — нативная навигация, local/hybrid —
   * `host.switch()`), вид замка (`aria-disabled`, guard). Побочный эффект
   * смены — у хоста (`onSwitch`), не у ссылки.
   *
   *     <StepLink host={steps} step="register">Создать аккаунт</StepLink>
   */
  import type { Snippet } from 'svelte'
  import type { StepsHost } from './steps.svelte'

  interface Props {
    host: StepsHost
    /** Ключ шага, куда ведёт ссылка. */
    step: string
    class?: string
    children?: Snippet
  }

  let { host, step, class: cls, children }: Props = $props()

  const locked = $derived(host.locked)
  const isCurrent = $derived(host.currentKey === step)
</script>

{#if isCurrent}
  <!-- текущий шаг ссылкой не бывает: рисуем текст с семантикой «где я» -->
  <span class={cls} aria-current="step">{@render children?.()}</span>
{:else}
  <a
    href={host.href(step)}
    onclick={(e) => {
      if (host.mode === 'url') return // нативная навигация — href и есть смена
      e.preventDefault()
      void host.switch(step)
    }}
    class={cls}
    aria-disabled={locked ? 'true' : undefined}
    class:pointer-events-none={locked}
    class:opacity-50={locked}
  >{@render children?.()}</a>
{/if}
