<script lang="ts">
  /** Ленивая обёртка модалки профиля — та же схема, что у AuthModalLazy. */
</script>

{#await import('./ProfileModal.svelte') then M}
  <M.default />
{/await}
