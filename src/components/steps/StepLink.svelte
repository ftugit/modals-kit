<script lang="ts">
  /**
   * Ссылка на шаг. Сантехника — вся из хоста (`href` — fallback без JS,
   * перехват клика по режиму, замок); форму выбирает проп `element`:
   *
   *     <StepLink host={steps} step="register">Дальше</StepLink>
   *     <StepLink host={steps} step="register" element="button" variant="outline">Дальше</StepLink>
   *
   * `element="button"` — та же кнопка-ссылка, что `<Button {...stepLink(...)}>`:
   * один вид кнопки, `aria-disabled` вместо disabled (замок и no-JS честные).
   * Собственный компонент — разворачиваете атрибуты сами: `{...stepLink(host, step)}`.
   */
  import type { Snippet } from 'svelte'
  import type { HTMLButtonAttributes } from 'svelte/elements'
  import type { StepsHost } from './steps.svelte'
  import { stepLink } from './link.svelte'
  import { buttonVariants } from '#components/ui/button/Button.svelte'

  interface Props extends Omit<HTMLButtonAttributes, 'element'> {
    host: StepsHost
    /** Ключ шага, куда ведёт ссылка. */
    step: string
    /** Форма: ссылка (умолчание) или кнопка-ссылка (вид кнопки, элемент `<a>`). */
    element?: 'a' | 'button'
    /** Размер/вариация кнопки (при `element="button"`). */
    size?: 'sm' | 'md' | 'lg'
    /** Вариация кнопки (при `element="button"`). */
    variant?: 'default' | 'outline' | 'ghost' | 'destructive' | 'secondary' | 'link'
    class?: string
    children?: Snippet
  }

  let { host, step, element = 'a', size, variant, class: cls, children }: Props = $props()

  const attrs = $derived(stepLink(host, step))
  const locked = $derived(host.locked)
  const isCurrent = $derived(host.currentKey === step)
  const kind = $derived(
    buttonVariants({ size, variant, class: cls }),
  )
</script>

{#if isCurrent}
  <!-- текущий шаг ссылкой не бывает: рисуем текст с семантикой «где я» -->
  <span class={cls} aria-current="step">{@render children?.()}</span>
{:else if element === 'button'}
  <a {...attrs} class={kind}>{@render children?.()}</a>
{:else}
  <a
    {...attrs}
    class={cls}
    class:pointer-events-none={locked}
    class:opacity-50={locked}
  >{@render children?.()}</a>
{/if}
