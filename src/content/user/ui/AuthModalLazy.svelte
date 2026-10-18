<script lang="ts">
  /**
   * Ленивая обёртка модалки входа: регистрация в реестре — статическая
   * (deep-link `?modal=user.auth` должен разрешаться сразу при старте хоста),
   * а тяжёлое содержимое (виджет, bind+Form, конвейер аватара) приезжает
   * отдельным чанком — layout ветки за него не платит.
   */
  let { data, ...rest }: { data: Record<string, unknown> } & Record<string, unknown> = $props()
</script>

{#await import('./AuthModal.svelte') then M}
  <M.default {data} {...rest} />
{/await}
