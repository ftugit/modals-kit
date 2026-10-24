<script module lang="ts">
  import { variants, type VariantProps } from '#components/utils.js'

  export const buttonVariants = variants(
    'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50',
    {
      variant: {
        default: 'bg-primary text-primary-foreground shadow-xs hover:bg-primary/90',
        secondary: 'bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/80',
        accent: 'bg-accent text-accent-foreground shadow-xs hover:bg-accent/80',
        destructive: 'bg-destructive text-destructive-foreground shadow-xs hover:bg-destructive/90',
        outline:
          'border border-input bg-background shadow-xs hover:bg-accent hover:text-accent-foreground',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-foreground underline-offset-4 hover:underline',
        // «plain»: только базовые утилиты — цвет, фон и радиус несёт класс
        // потребителя. Нужен там, где рисунок кнопки свой (иконки, элементы
        // меню), а нужна вся семантика примитива (disabled, aria, type).
        plain: '',
      },
      size: {
        xs: 'h-7 rounded-md px-2 text-xs',
        sm: 'h-8 px-3 text-sm',
        md: 'h-9 px-4 text-sm',
        lg: 'h-10 px-6 text-sm',
        icon: 'h-9 w-9',
        'icon-sm': 'h-8 w-8',
        none: '',
      },
    },
    { variant: 'default', size: 'md' },
  )

  export type ButtonVariants = VariantProps<{
    variant: Record<
      'default' | 'secondary' | 'accent' | 'destructive' | 'outline' | 'ghost' | 'link' | 'plain',
      string
    >
    size: Record<'xs' | 'sm' | 'md' | 'lg' | 'icon' | 'icon-sm' | 'none', string>
  }>
</script>

<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { HTMLAnchorAttributes, HTMLButtonAttributes } from 'svelte/elements'
  import { IDLE_TASK, type TaskState } from '#lib/task/index.js'
  import { taskAttachment } from '#hooks/links/state.svelte.js'

  interface Props extends HTMLButtonAttributes, ButtonVariants {
    children?: Snippet
    /**
     * Есть ключ `href` — рисуется `<a>` с тем же видом: ссылка в облике кнопки
     * без JS остаётся ссылкой. `null` — заблокированная ссылка (`<a>` без
     * адреса), так её отдают `asLink`/`asModalLink`:
     *
     *     <Button {...asModalLink('card', { id: 7 })} variant="outline">Карточка</Button>
     */
    href?: string | null
    /**
     * Forwarded ref: узел <button> в руки потребителю. Нужен вместо
     * `bind:this`, которое у компонента отдаёт экземпляр, а не элемент
     * (фокус-менеджмент и геометрия триггера опираются на узел). У `<a>`
     * (`href`) не вызывается.
     */
    ref?: (el: HTMLButtonElement | null) => void
    /**
     * Задача, которую ведёт кнопка (`#lib/task`): отправка формы, загрузка.
     * Пока `pending` — спиннер (через 150 мс) и процент, если он известен,
     * тем же правилом CSS, что у ссылок, и `aria-busy`; повторный клик гасится
     * сразу; кнопка `disabled` (у `<a>` — `aria-disabled`); задача видна в
     * глобальном лоадере. `error` — знак «!» и причина в `title`.
     *
     *     <Button type="submit" task={formTask(form.state)}>Добавить</Button>
     */
    task?: TaskState
  }

  let {
    variant,
    size,
    class: cls,
    type = 'button',
    href,
    children,
    ref,
    task,
    ...rest
  }: Props = $props()

  // Вложение задачи — только когда она есть. Выражение `{@attach}` зависит от
  // `hasTask`, а не от `task`: смена состояния задачи вложение не пересоздаёт.
  const hasTask = $derived(task !== undefined)
  // Пока задача идёт, кнопка недоступна сразу (без задержки спиннера); свой
  // `disabled`/`aria-disabled` потребителя действует как прежде.
  const busy = $derived(task?.status === 'pending')
  const attachTask = taskAttachment(() => task ?? IDLE_TASK)

  let self = $state<HTMLButtonElement | null>(null)
  // ref — эффект: потребителю нужен именно элемент (getBoundingClientRect, focus()).
  $effect(() => ref?.(self))
</script>

<!-- `data-slot="button"`: по нему общее правило индикатора ссылок
     (`hooks/links/indicator.ts`) убирает свой отступ — у кнопки есть `gap`.
     `data-task`: то же правило рисует состояние задачи кнопки. -->
{#if href !== undefined}
  <a
    href={href ?? undefined}
    data-slot="button"
    class={buttonVariants({ variant, size, class: cls })}
    data-task={hasTask ? '' : undefined}
    {...rest as HTMLAnchorAttributes}
    aria-disabled={busy ? 'true' : (rest as HTMLAnchorAttributes)['aria-disabled']}
    {@attach hasTask ? attachTask : undefined}
  >
    {#if children}{@render children()}{/if}
  </a>
{:else}
  <button
    bind:this={self}
    {type}
    data-slot="button"
    class={buttonVariants({ variant, size, class: cls })}
    data-task={hasTask ? '' : undefined}
    {...rest}
    disabled={busy || rest.disabled}
    {@attach hasTask ? attachTask : undefined}
  >
    {#if children}{@render children()}{/if}
  </button>
{/if}
