<script lang="ts">
  // Глобальный список блокировок — section-компонент (тонкий носитель в route).
  import type { loadBlocks } from './load.server.js'
  import { useHeadSeo } from '#core/ui/shell/index.js'
  import Acl from '#modules/user/base/svelte/Acl.svelte'
  import BlocksList from '#modules/user/blocks/svelte/BlocksList.svelte'

  let { data }: { data: Awaited<ReturnType<typeof loadBlocks>> } = $props()

  useHeadSeo({
    subTitle: 'Блокировки',
    description: 'Журнал блокировок пользователей и управление ограничениями доступа.',
    noindex: true,
  })
</script>

<div class="mx-auto w-full max-w-2xl">
  {#if data.fact}
    <Acl status={data.fact} enabled={data.enabled} backHref="/" />
  {:else}
    <BlocksList initial={data} variant="card" sidebar="middle" />
  {/if}
</div>
