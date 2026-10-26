<script lang="ts">
  /** Ленивая обёртка списка в модалке — та же схема, что у ProfileModalLazy. */
</script>

{#await import('./SeedUsersModal.svelte') then M}
  <M.default />
{/await}
