<script lang="ts">
  // Глобальный список блокировок (`/blocks`) — носитель пары `user.blocks` без `uid`.
  import { useHeadSeo } from '#components/shell/index.js'
  import Acl from '#content/user/ui/Acl.svelte'
  import BlocksList from '#content/user/ui/BlocksList.svelte'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()

  useHeadSeo({
    subTitle: 'Блокировки',
    description: 'Журнал блокировок пользователей и управление ограничениями доступа.',
    noindex: true,
  })
</script>

<div class="mx-auto w-full max-w-2xl">
  {#if data.fact === 'auth.forbidden'}
    <Acl model="forbidden" backHref="/" />
  {:else if data.fact}
    <Acl status={data.fact} backHref="/" />
  {:else}
    <BlocksList initial={data} />
  {/if}
</div>
