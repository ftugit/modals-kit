<script lang="ts">
  // Отображение пар «подпись поля схемы → значение записи».
  // Поля, удалённые из текущей схемы набора, в вывод не попадают.
  import { cn } from '#components/utils.js'
  import type { SchemaValuesProps } from './types.js'
  import { fieldsLayoutVariants } from './variants.js'

  let {
    fields,
    values,
    emptyText = '—',
    class: cls,
  }: SchemaValuesProps = $props()

  const labelOf = (key: string) => fields.find((f) => f.name === key)?.label
  const shown = $derived(Object.entries(values).filter(([key]) => labelOf(key) !== undefined))
  const formatValue = (v: unknown) => (v === undefined || v === null || v === '' ? emptyText : String(v))
</script>

{#if shown.length}
  <dl class={cn(fieldsLayoutVariants({ layout: 'values' }), cls)}>
    {#each shown as [key, value] (key)}
      <dt class="text-muted-foreground">{labelOf(key)}</dt>
      <dd class="break-words">{formatValue(value)}</dd>
    {/each}
  </dl>
{/if}
