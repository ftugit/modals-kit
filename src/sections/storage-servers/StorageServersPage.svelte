<script lang="ts">
  // Серверы боевого хранилища (`/storage-servers`) — section-носитель + ACL-гейт.
  // Данные приходят из `loadStorageServers` (тонкий route-адаптер).
  import { useHeadSeo } from '#core/ui/shell/index.js'
  import { StorageServersView } from '#modules/storage-servers/index.js'
  import Acl from '#modules/user/base/svelte/Acl.svelte'
  import type { loadStorageServers } from './load.server.js'

  let { data }: { data: Awaited<ReturnType<typeof loadStorageServers>> } = $props()

  useHeadSeo({
    subTitle: 'Серверы хранилища',
    description: 'Администрирование пула серверов боевого файлового хранилища приложения.',
    noindex: true,
  })
</script>

<div class="mx-auto w-full max-w-2xl">
  {#if data.fact}
    <Acl status={data.fact} enabled={data.enabled} backHref="/" />
  {:else}
    <StorageServersView
      initial={data}
      enabled={data.enabled}
      authorized={Boolean(data.slice)}
      doneHref="/"
      action="/storage-servers"
    />
  {/if}
</div>
