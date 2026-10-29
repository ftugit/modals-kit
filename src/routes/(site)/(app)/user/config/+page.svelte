<script lang="ts">
  // Страница своих настроек (`/user/config`) — тонкий носитель + ACL-гейт.
  import Acl from '#content/user/ui/Acl.svelte'
  import { UserConfig } from '#content/user/ui/user-config/index.js'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()
</script>

<svelte:head><title>Настройки</title></svelte:head>

<div class="mx-auto w-full max-w-md">
  {#if data.fact === 'auth.identity-unknown'}
    <Acl model="not_found" backHref="/" />
  {:else if data.fact === 'auth.forbidden'}
    <Acl model="forbidden" backHref="/" />
  {:else if data.fact}
    <Acl status={data.fact} backHref="/" />
  {:else}
    <UserConfig
      initial={data}
      enabled={data.enabled}
      authorized={Boolean(data.slice)}
      doneHref={data.uid ? `/user/${data.uid}` : '/'}
      action={`/user/config?next=${encodeURIComponent(data.uid ? `/user/${data.uid}` : '/')}`}
    />
  {/if}
</div>
