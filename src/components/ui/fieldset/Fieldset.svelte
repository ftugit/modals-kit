<script lang="ts">
  /**
   * Группа полей — по референсу shadcn/ui v4 (`ui/field.tsx`: FieldSet, FieldLegend,
   * FieldDescription), одной обёрткой:
   *   • `legend` — подпись группы; `legendVariant`: `legend` (крупнее, по умолчанию) или
   *     `label` (размер подписи поля — для вложенных групп), `hidden` — только для
   *     скринридера (группа видна как есть, а имя у неё есть);
   *   • `description` — пояснение под подписью;
   *   • `legendSnippet` — подпись с разметкой вместо строки.
   * `min-w-0` — не украшение: у `<fieldset>` по умолчанию `min-inline-size: min-content`,
   * и широкое содержимое (сетка, длинная строка) распирало бы его шире родителя.
   * `-mx-1 px-1` у легенды: в группе с рамкой легенда лежит в линии рамки, и без отступа
   * линия упирается в текст; без рамки пара взаимно гасится и ничего не сдвигает.
   * Атрибуты `<fieldset>` (`disabled`, `data-*`) передаются как есть.
   */
  import type { Snippet } from 'svelte'
  import type { HTMLFieldsetAttributes } from 'svelte/elements'
  import { cn } from '#components/utils.js'

  interface Props extends HTMLFieldsetAttributes {
    legend?: string
    legendVariant?: 'legend' | 'label' | 'hidden'
    description?: string
    legendSnippet?: Snippet
    children?: Snippet
  }

  let { legend, legendVariant = 'legend', description, legendSnippet, class: cls, children, ...rest }: Props = $props()

  const legendClass = $derived(
    legendVariant === 'hidden' ? 'sr-only' : cn('-mx-1 mb-3 px-1 font-medium', legendVariant === 'label' ? 'text-sm' : 'text-base'),
  )
</script>

<fieldset data-slot="field-set" class={cn('flex min-w-0 flex-col gap-6', cls)} {...rest}>
  {#if legendSnippet}
    <legend data-slot="field-legend" data-variant={legendVariant} class={legendClass}>{@render legendSnippet()}</legend>
  {:else if legend}
    <legend data-slot="field-legend" data-variant={legendVariant} class={legendClass}>{legend}</legend>
  {/if}
  {#if description}
    <p data-slot="field-description" class="-mt-4 text-sm text-muted-foreground">{description}</p>
  {/if}
  {#if children}{@render children()}{/if}
</fieldset>
