<script lang="ts">
  // Страница серверов боевого хранилища (`/storage-servers`) — тонкий носитель + ACL-гейт.
  import { StorageServersView } from '#content/storage-servers/index.js'
  import Acl from '#content/user/ui/Acl.svelte'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()
</script>

<svelte:head><title>Серверы хранилища</title></svelte:head>

<div class="mx-auto w-full max-w-2xl">
  {#if data.fact === 'auth.forbidden'}
    <Acl model="forbidden" backHref="/" />
  {:else if data.fact}
    <Acl status={data.fact} backHref="/" />
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
