<script lang="ts">
  /** Ленивая обёртка меню пользователя — та же схема, что у AuthModalLazy. */
</script>

{#await import('./MenuModal.svelte') then M}
  <M.default />
{/await}
