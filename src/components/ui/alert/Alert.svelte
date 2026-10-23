<script module lang="ts">
  /**
   * Блок сообщения — по референсу shadcn/ui v4 (`ui/alert.tsx`: Alert, AlertTitle,
   * AlertDescription), но одной обёрткой: `title` — заголовок, содержимое — описание,
   * `icon` — необязательная иконка слева (сетка `[0_1fr]` → `[1rem_1fr]`, как там).
   *
   * Роль по умолчанию `alert` (как у shadcn); для спокойного итога («запись создана»)
   * передайте `role="status"` — переданные атрибуты идут после своих.
   *
   * Цвет текста — `text-foreground` на тонированном фоне, а не цвет варианта: тёмно-красный
   * текст на 5–10 % красной подложки не добирает контраста 4.5:1 (см. `Common.svelte`).
   */
  import { variants, type VariantProps } from '#components/utils.js'

  export const alertVariants = variants(
    'relative grid w-full grid-cols-[0_1fr] items-start gap-y-0.5 rounded-lg border px-4 py-3 text-sm has-[>svg]:grid-cols-[1rem_1fr] has-[>svg]:gap-x-3 [&>svg]:size-4 [&>svg]:translate-y-0.5 [&>svg]:shrink-0',
    {
      variant: {
        default: 'border-border bg-card text-card-foreground',
        info: 'border-info/40 bg-info/10 text-foreground [&>svg]:text-info',
        success: 'border-success/40 bg-success/10 text-foreground [&>svg]:text-success',
        warning: 'border-warning/40 bg-warning/10 text-foreground [&>svg]:text-warning',
        destructive: 'border-destructive/40 bg-destructive/10 text-foreground [&>svg]:text-destructive',
      },
    },
    { variant: 'default' },
  )

  export interface AlertProps
    extends Record<string, unknown>,
      VariantProps<{
        variant: Record<'default' | 'info' | 'success' | 'warning' | 'destructive', string>
      }> {}
</script>

<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'

  interface ComponentProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'>, AlertProps {
    /** Заголовок (AlertTitle). */
    title?: string
    /** Иконка слева — `<svg>`; без неё текст начинается от края. */
    icon?: Snippet
    /** Описание (AlertDescription). */
    children?: Snippet
  }

  let { variant, title, icon, class: cls, children, ...rest }: ComponentProps = $props()
</script>

<div role="alert" data-slot="alert" class={alertVariants({ variant, class: cls })} {...rest}>
  {#if icon}{@render icon()}{/if}
  {#if title}
    <div data-slot="alert-title" class="col-start-2 min-h-4 font-medium tracking-tight">{title}</div>
  {/if}
  {#if children}
    <div data-slot="alert-description" class="col-start-2 grid justify-items-start gap-1 text-sm [&_p]:leading-relaxed">
      {@render children()}
    </div>
  {/if}
</div>
