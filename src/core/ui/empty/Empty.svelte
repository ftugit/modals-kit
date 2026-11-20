<script lang="ts" module>
  import { variants } from '#core/ui/utils.js'

  /**
   * Оформление пустого состояния. `default` — карточка, `dashed` — пустое
   * место списка, `plain` — без рамки и фона (внутри другой поверхности).
   */
  export const emptyVariants = variants(
    'flex flex-col gap-3',
    {
      variant: {
        default: 'rounded-xl border border-border bg-card',
        dashed: 'rounded-xl border border-dashed border-border',
        plain: '',
      },
      size: { sm: 'p-4 text-sm', md: 'p-6 text-sm', lg: 'p-8 text-base' },
      align: { center: 'items-center text-center', start: 'items-start text-left' },
    },
    { variant: 'default', size: 'md', align: 'center' },
  )
</script>

<script lang="ts">
  // Презентация пустоты: иконка, заголовок, описание и действия.
  // Причину пустоты знает вызывающий (таксономия — в §7a.10), сам `Empty` её не вычисляет.
  import type { Snippet } from 'svelte'
  import { cn } from '#core/ui/utils.js'

  interface Props {
    icon?: Snippet
    title: string
    description?: string
    /** Основное действие: ссылка или кнопка. */
    action?: Snippet
    /** Дополнительное действие: вторая кнопка или ссылка. */
    secondaryAction?: Snippet
    variant?: 'default' | 'dashed' | 'plain'
    size?: 'sm' | 'md' | 'lg'
    align?: 'center' | 'start'
    /** `status` — спокойное пустое состояние, `alert` — ошибка/недоступность. */
    role?: 'status' | 'alert'
    class?: string
    'data-testid'?: string
    children?: Snippet
  }

  let {
    icon,
    title,
    description,
    action,
    secondaryAction,
    variant = 'default',
    size = 'md',
    align = 'center',
    role = 'status',
    class: cls,
    'data-testid': testId,
    children,
  }: Props = $props()
</script>

<div
  {role}
  class={cn(emptyVariants({ variant, size, align }), cls)}
  data-testid={testId}
  data-slot="empty"
>
  {#if icon}
    <div
      class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"
      aria-hidden="true"
    >
      {@render icon()}
    </div>
  {/if}

  <div class={cn('flex min-w-0 flex-col gap-1', align === 'center' ? 'items-center' : 'items-start')}>
    <p class="text-sm font-medium text-foreground">{title}</p>
    {#if description}
      <p class="whitespace-normal break-words text-sm text-muted-foreground">{description}</p>
    {/if}
  </div>

  {#if children}{@render children()}{/if}

  {#if action || secondaryAction}
    <div class="flex flex-wrap items-center justify-center gap-2">
      {#if action}{@render action()}{/if}
      {#if secondaryAction}{@render secondaryAction()}{/if}
    </div>
  {/if}
</div>
