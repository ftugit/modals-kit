<script lang="ts">
  import { useHeadSeo } from '#core/ui/shell/index.js'
  import StorageVaultDeleteModal from '#content/storage-vault/ui/StorageVaultDeleteModal.svelte'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()

  useHeadSeo({
    subTitle: 'Удаление сервера хранилища',
    description: 'Подтверждение удаления сервера хранилища из куки-сейфа.',
    noindex: true,
  })
</script>

<div class="mx-auto w-full max-w-sm">
  <StorageVaultDeleteModal slotId={data.slot} backHref={data.backHref} />
</div>
