<script lang="ts">
  // Обёртка поля — код приложения: она решает, где подпись, где подсказка
  // и где текст ошибки. Библиотека даёт идентификаторы, чтобы связи
  // доступности указывали на существующие узлы.
  import { Label } from '$lib/ui/primitives'
  import type { FieldView } from '$lib/form/svelte'
  import type { Snippet } from 'svelte'

  let { f, children }: { f: FieldView; children: Snippet } = $props()
</script>

<div class="space-y-1.5" class:opacity-100={true}>
  <Label {...f.labelProps()}>
    {f.label}
    <!-- подсветка берётся из `has`, а не из наличия текста -->
    {#if f.has && f.errors.length === 0}
      <em class="ml-1 text-xs text-destructive not-italic">ошибка без текста</em>
    {/if}
  </Label>
  {@render children()}
  {#if f.help}
    <p {...f.helpProps()} class="text-xs text-muted-foreground">{f.help}</p>
  {/if}
  {#if f.errors[0]}
    <p {...f.errorProps()} class="text-xs font-medium text-destructive">{f.errors[0].message}</p>
  {/if}
  {#if f.errors.length > 1}
    <ul class="list-disc pl-4 text-xs text-destructive">
      {#each f.errors.slice(1) as e (e.id)}<li>{e.message}</li>{/each}
    </ul>
  {/if}
</div>
