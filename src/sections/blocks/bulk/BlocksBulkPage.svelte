<script lang="ts">
  // Страница наборных действий над блокировками (`/blocks/bulk`) — fallback
  // модалки `user.blocks.bulk`. Набор приходит адресом, срез считает сервер.
  import type { loadBlocksBulk } from './load.server.js'
  import { useHeadSeo } from '#core/ui/shell/index.js'
  import Acl from '#modules/user/base/svelte/Acl.svelte'
  import BlocksBulk from '#modules/user/blocks/svelte/blocks-bulk/BlocksBulk.svelte'
  import { blocksListRoute } from '#modules/user/base/routes.js'
  
  let { data }: { data: Awaited<ReturnType<typeof loadBlocksBulk>> } = $props()

  const list = blocksListRoute.href()

  useHeadSeo({
    subTitle: 'Блокировки набором',
    description: 'Подтверждение снятия или удаления выбранных блокировок либо записей в срезе.',
    noindex: true,
  })
</script>

<div class="mx-auto w-full max-w-sm">
  {#if data.fact}
    <Acl status={data.fact} enabled={data.enabled} backHref={list} />
  {:else}
    <BlocksBulk ids={data.ids} sliceFields={data.sliceFields} initial={data} doneHref={list} />
  {/if}
</div>
