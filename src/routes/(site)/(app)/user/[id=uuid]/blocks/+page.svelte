<script lang="ts">
  // Список блокировок конкретного пользователя (`/user/[id]/blocks`) — носитель пары `user.blocks`.
  import { Button } from '#components/ui/index.js'
  import { useModalLink } from '#hooks/links/index.js'
  import Acl from '#content/user/ui/Acl.svelte'
  import BlocksList from '#content/user/ui/BlocksList.svelte'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()
  const asModalLink = useModalLink()
</script>

<svelte:head><title>Блокировки пользователя</title></svelte:head>

<div class="mx-auto w-full max-w-2xl">
  {#if data.fact === 'auth.forbidden'}
    <Acl model="forbidden" backHref={`/user/${data.uid}`} />
  {:else if data.fact === 'auth.identity-unknown'}
    <Acl model="not_found" backHref="/" />
  {:else if data.fact}
    <Acl status={data.fact} backHref="/" />
  {:else}
    <div class="mb-3">
      <Button {...asModalLink('user.profile', { id: data.uid ?? '' })} variant="ghost" size="sm">
        ← К профилю
      </Button>
    </div>
    <BlocksList uid={data.uid} initial={data} />
  {/if}
</div>
