<script lang="ts">
  // Страница настроек пользователя по UUID (`/user/[id]/config`) — тонкий носитель + ACL-гейт.
  import Acl from '#content/user/ui/Acl.svelte'
  import { UserConfig } from '#content/user/ui/user-config/index.js'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()
  const backHref = $derived(data.uid ? `/user/${data.uid}` : '/')
</script>

<svelte:head><title>Настройки пользователя</title></svelte:head>

<div class="mx-auto w-full max-w-md">
  {#if data.fact === 'auth.identity-unknown'}
    <Acl model="not_found" {backHref} />
  {:else if data.fact === 'auth.forbidden'}
    <Acl model="forbidden" {backHref} />
  {:else if data.fact}
    <Acl status={data.fact} {backHref} />
  {:else}
    <UserConfig
      uid={data.uid}
      initial={data}
      enabled={data.enabled}
      authorized={Boolean(data.slice)}
      doneHref={backHref}
      action={`/user/${data.uid}/config?next=${encodeURIComponent(backHref)}`}
    />
  {/if}
</div>
