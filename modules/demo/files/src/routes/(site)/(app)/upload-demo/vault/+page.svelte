<script lang="ts">
  /**
   * Отдельный маршрут куки-сейфа хранилищ (`/upload-demo/vault`):
   * работает при выключенном JS или прямом переходе по ссылке, а его `load`
   * переиспользуется модалкой `storage.vault` через `preloadData`.
   */
  import { useHeadSeo } from '#components/shell/index.js'
  import StorageVaultView from '#content/storage-vault/ui/StorageVaultView.svelte'

  let { data } = $props()

  useHeadSeo({
    subTitle: 'Куки-сейф хранилищ S3',
    description:
      'Управление пользовательскими серверами S3 и WebDAV в зашифрованных HttpOnly-куках для стенда загрузки.',
    noindex: true,
  })
</script>

<div class="mx-auto w-full max-w-2xl" data-testid="storage-vault-page">
  <div class="rounded-xl border border-border bg-card p-6 text-card-foreground shadow-sm">
    <StorageVaultView snapshot={data.vaultSnapshot} backHref={data.backHref} />
  </div>
</div>
