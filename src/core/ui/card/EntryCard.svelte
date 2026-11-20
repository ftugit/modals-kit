<script lang="ts" module>
  import { variants } from '#core/ui/utils.js'

  /** Карточка-вход: один вид для всех «разделов-плиток» без копий разметки. */
  export const entryCardVariants = variants(
    '',
    {
      variant: {
        default: 'bg-card text-card-foreground',
        muted: 'bg-muted/50 text-foreground',
      },
    },
    { variant: 'default' },
  )

  export type EntryCardVariant = 'default' | 'muted'
</script>

<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import { cn } from '#core/ui/utils.js'
  import Card from './Card.svelte'
  import CardDescription from './CardDescription.svelte'

  interface Props extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
    title: string
    description?: string
    /** Основные действия под описанием. */
    actions?: Snippet
    /** Дополнительный блок под действиями. */
    footer?: Snippet
    /** Бейдж рядом с заголовком. */
    badge?: Snippet
    variant?: EntryCardVariant
  }

  let {
    title,
    description,
    actions,
    footer,
    badge,
    variant = 'default',
    class: cls,
    ...rest
  }: Props = $props()

  const rawId = $props.id()
  const titleId = `${rawId}-title`
</script>

<Card
  {...rest}
  role="region"
  aria-labelledby={titleId}
  variant={variant}
  class={cn('flex flex-col gap-4 p-6', entryCardVariants({ variant }), cls)}
  data-slot="entry-card"
  data-variant={variant}
>
  <div class="flex min-w-0 flex-wrap items-center gap-2">
    <h2 id={titleId} class="min-w-0 text-xl font-semibold tracking-tight">{title}</h2>
    {#if badge}{@render badge()}{/if}
  </div>

  {#if description}
    <CardDescription class="leading-relaxed">{description}</CardDescription>
  {/if}

  {#if actions}
    <div class="flex flex-wrap items-center gap-2">{@render actions()}</div>
  {/if}

  {#if footer}
    <div class="flex flex-col gap-2 pt-1">{@render footer()}</div>
  {/if}
</Card>
