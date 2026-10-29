<script lang="ts">
  // Глобальный список блокировок (`/blocks`) — носитель пары `user.blocks` без `uid`.
  import Acl from '#content/user/ui/Acl.svelte'
  import BlocksList from '#content/user/ui/BlocksList.svelte'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()
</script>

<svelte:head><title>Блокировки</title></svelte:head>

<div class="mx-auto w-full max-w-2xl">
  {#if data.fact === 'auth.forbidden'}
    <Acl model="forbidden" backHref="/" />
  {:else if data.fact}
    <Acl status={data.fact} backHref="/" />
  {:else}
    <BlocksList initial={data} />
  {/if}
</div>
