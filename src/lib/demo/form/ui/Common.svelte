<script lang="ts">
  // Общий блок: ошибки без пути. Код приложения.
  import type { FormError } from '#lib/form/index.js'
  import Alert from '#lib/components/ui/alert/Alert.svelte'

  let { errors, title }: { errors: readonly FormError[]; title?: string } = $props()
</script>

<!-- Alert держит текст цветом `foreground`: красный текст на тонированном фоне
     не добирает 4.5:1 (было 4.36:1); сигнал несут рамка и подложка. -->
{#if errors.length}
  <Alert variant="destructive" aria-live="assertive" {title}>
    {#each errors as e (e.id)}<p>{e.message}</p>{/each}
  </Alert>
{/if}
