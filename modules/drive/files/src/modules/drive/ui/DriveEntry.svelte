<script lang="ts">
  /**
   * Точка входа в «Диск» на главной — только для авторизованных.
   *
   * Видимость — по факту входа (`vault.authorized`), как у `SeedUsersEntry`:
   * гостю блок не нужен. Права на сам список проверяет экран `/drive`.
   * Разметка — общий `EntryCard`, второго вида «плитки» не заводим.
   */
  import { Button, EntryCard } from '#core/ui/index.js'
  import { useModalLink } from '#core/hooks/links/index.js'
  import { vault } from '#modules/user/base/svelte/vault.svelte.js'

  const asModalLink = useModalLink()
  const authorized = $derived(vault.authorized)
  const openLink = $derived(asModalLink('drive.browse'))
</script>

{#if authorized}
  <EntryCard
    title="Диск"
    description="Папки и файлы с квотой, корзиной и доступом; можно смонтировать по WebDAV."
    data-testid="drive-entry"
  >
    {#snippet actions()}
      <Button {...openLink}>Открыть диск</Button>
    {/snippet}
  </EntryCard>
{/if}
