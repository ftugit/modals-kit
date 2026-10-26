<script lang="ts">
  /** Ленивая обёртка профиля в модалке — та же схема, что у AuthModalLazy. */
</script>

{#await import('./ProfileModal.svelte') then M}
  <M.default />
{/await}
