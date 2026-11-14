<script lang="ts">
  // Страница наборных действий над блокировками (`/blocks/bulk`) — fallback
  // модалки `user.blocks.bulk`. Набор приходит адресом, срез считает сервер.
  import { useHeadSeo } from '#components/shell/index.js'
  import Acl from '#content/user/ui/Acl.svelte'
  import BlocksBulk from '#content/user/ui/blocks-bulk/BlocksBulk.svelte'
  import { blocksListRoute } from '#content/user/routes.js'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()

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
