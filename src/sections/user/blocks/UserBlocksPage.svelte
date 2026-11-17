<script lang="ts">
  // Список блокировок конкретного пользователя — section-компонент (тонкий носитель в route).
  import type { loadUserBlocks } from './load.server.js'
  import { useHeadSeo } from '#core/ui/shell/index.js'
  import { Button } from '#core/ui/index.js'
  import { useModalLink } from '#core/hooks/links/index.js'
  import Acl from '#modules/user/base/svelte/Acl.svelte'
  import BlocksList from '#modules/user/blocks/svelte/BlocksList.svelte'

  let { data }: { data: Awaited<ReturnType<typeof loadUserBlocks>> } = $props()
  const asModalLink = useModalLink()

  useHeadSeo({
    subTitle: 'Блокировки пользователя',
    description: 'История и активные блокировки выбранного пользователя.',
    noindex: true,
  })
</script>

<div class="mx-auto w-full max-w-2xl">
  {#if data.fact}
    <Acl status={data.fact} enabled={data.enabled} backHref={data.fact === 'auth.forbidden' ? `/user/${data.uid}` : '/'} />
  {:else}
    <div class="mb-3">
      <Button {...asModalLink('user.profile', { id: data.uid ?? '' })} variant="ghost" size="sm">
        ← К профилю
      </Button>
    </div>
    {#key data.uid}
      <BlocksList uid={data.uid} initial={data} variant="card" sidebar="middle" />
    {/key}
  {/if}
</div>
