<script lang="ts">
  // Общий блок: ошибки без пути. Код приложения.
  import type { FormError } from '$lib/form'

  let { errors, title }: { errors: readonly FormError[]; title?: string } = $props()
</script>

<!-- без bg-подложки: text-destructive на 5%-тонированном фоне даёт 4.36:1.
     Рамка и цвет текста держат сигнал в обеих темах. -->
{#if errors.length}
  <div role="alert" aria-live="assertive"
       class="rounded-lg border border-destructive/40 px-3 py-2">
    {#if title}<div class="mb-1 text-xs font-semibold text-destructive">{title}</div>{/if}
    {#each errors as e (e.id)}
      <p class="text-sm text-destructive">{e.message}</p>
    {/each}
  </div>
{/if}
