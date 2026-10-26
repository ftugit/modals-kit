<script lang="ts">
  /** Ленивая обёртка фильтров списка — та же схема, что у SeedUsersModalLazy. */
</script>

{#await import('./SeedUsersFiltersModal.svelte') then M}
  <M.default />
{/await}
