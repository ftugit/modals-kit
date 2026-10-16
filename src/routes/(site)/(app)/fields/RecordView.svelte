<script lang="ts">
  // Пример сохранённой записи: название, изображение (data URL из кэша) и поля набора.
  import type { SavedRecord } from './forms'

  let { record }: { record: SavedRecord } = $props()
</script>

<section class="space-y-3" aria-labelledby="fields-step-view" data-testid="record-view">
  <h2 id="fields-step-view" class="text-xl font-semibold">3. Сохранённая запись</h2>
  <article class="space-y-3 rounded-xl border border-border bg-card p-4">
    <h3 class="text-lg font-medium" data-testid="record-title">{record.title}</h3>
    <img src={record.image} alt={record.title} class="max-h-64 max-w-full rounded-md border border-border" />
    {#if record.entries.length}
      <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        {#each record.entries as e, i (i)}
          <dt class="text-muted-foreground">{e.label}</dt>
          <dd class="break-words">{e.value}</dd>
        {/each}
      </dl>
    {/if}
  </article>
</section>
