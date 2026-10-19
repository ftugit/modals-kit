<script lang="ts">
  /**
   * Ссылка на шаг: по умолчанию `<a>`; атрибуты отдаёт хост (`href` — fallback
   * без JS, перехват клика по режиму, замок). Свой вид/элемент — сниппет
   * `as` (паттерн `asLink`: `<Button {...stepLink(...)}>`, no-JS остаётся
   * ссылкой в облике кнопки):
   *
   *     <StepLink host={steps} step="register">Дальше</StepLink>
   *     <StepLink host={steps} step="register" as={attrs => <Button {...attrs} variant="outline" />}>Дальше</StepLink>
   */
  import type { Snippet } from 'svelte'
  import type { StepsHost } from './steps.svelte'
  import { stepLink } from './link.svelte'

  interface Props {
    host: StepsHost
    /** Ключ шага, куда ведёт ссылка. */
    step: string
    class?: string
    /** Свой элемент: сниппет получает атрибуты `stepLink` (href + перехват). */
    as?: Snippet<[ReturnType<typeof stepLink>]>
    children?: Snippet
  }

  let { host, step, class: cls, as, children }: Props = $props()

  const attrs = $derived(stepLink(host, step))
  const locked = $derived(host.locked)
  const isCurrent = $derived(host.currentKey === step)
</script>

{#if isCurrent}
  <!-- текущий шаг ссылкой не бывает: рисуем текст с семантикой «где я» -->
  <span class={cls} aria-current="step">{@render children?.()}</span>
{:else if as}
  {@render as(attrs)}
{:else}
  <a
    {...attrs}
    class={cls}
    class:pointer-events-none={locked}
    class:opacity-50={locked}
  >{@render children?.()}</a>
{/if}
