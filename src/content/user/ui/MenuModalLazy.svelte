<script lang="ts">
  /** Ленивая обёртка меню пользователя — та же схема, что у AuthModalLazy. */
  let { ...rest }: Record<string, unknown> = $props()
</script>

{#await import('./MenuModal.svelte') then M}
  <M.default {...rest} />
{/await}
