<script lang="ts">
  // Пример сохранённой записи: заголовок, изображение и `ключ: значение` полей набора.
  // Подпись берётся из набора по ключу; ключа в наборе нет (поле удалили) — строка не выводится.
  import type { SavedRecord, SavedSet } from './forms'

  let { record, set }: { record: SavedRecord; set: SavedSet | null } = $props()

  const label = (key: string) => set?.fields.find((f) => f.name === key)?.label
  const shown = $derived(Object.entries(record.values).filter(([key]) => label(key) !== undefined))
  const text = (v: unknown) => (v === undefined || v === null || v === '' ? '—' : String(v))
</script>

<section class="space-y-3" aria-labelledby="fields-step-view" data-testid="record-view">
  <h2 id="fields-step-view" class="text-xl font-semibold">3. Сохранённая запись</h2>
  <article class="space-y-3 rounded-xl border border-border bg-card p-4">
    <h3 class="text-lg font-medium" data-testid="record-title">{record.title}</h3>
    <img src={record.image} alt={record.title} class="max-h-64 max-w-full rounded-md border border-border" />
    {#if shown.length}
      <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        {#each shown as [key, value] (key)}
          <dt class="text-muted-foreground">{label(key)}</dt>
          <dd class="break-words">{text(value)}</dd>
        {/each}
      </dl>
    {/if}
  </article>
</section>
