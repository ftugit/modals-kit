<script lang="ts">
  /**
   * Отдельный маршрут куки-сейфа хранилищ (`/upload-demo/vault`):
   * работает при выключенном JS или прямом переходе по ссылке, а его `load`
   * переиспользуется модалкой `storage.vault` через `preloadData`.
   */
  import StorageVaultView from '#content/storage-vault/ui/StorageVaultView.svelte'

  let { data } = $props()
</script>

<svelte:head>
  <title>Куки-сейф хранилищ S3 · Демо загрузки</title>
</svelte:head>

<div class="mx-auto max-w-2xl px-6 py-8" data-testid="storage-vault-page">
  <div class="rounded-xl border border-border bg-card p-5 shadow-sm">
    <StorageVaultView snapshot={data.vaultSnapshot} backHref={data.backHref} />
  </div>
</div>
