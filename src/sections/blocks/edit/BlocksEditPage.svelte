<script lang="ts">
  // Карточка редактирования / просмотра блокировки из глобального списка (`/blocks/[blockId]`).
  import type { loadBlocksEdit } from './load.server.js'
  import { useHeadSeo } from '#core/ui/shell/index.js'
  import { Button } from '#core/ui/index.js'
  import Acl from '#modules/user/base/svelte/Acl.svelte'
  import BlockForm from '#modules/user/blocks/svelte/block-form/BlockForm.svelte'
  
  let { data }: { data: Awaited<ReturnType<typeof loadBlocksEdit>> } = $props()

  useHeadSeo({
    subTitle: 'Блокировка',
    description: 'Просмотр и редактирование записи о блокировке.',
    noindex: true,
  })
</script>

<div class="mx-auto w-full max-w-md">
  {#if data.fact}
    <Acl status={data.fact} enabled={data.enabled} backHref={'/blocks'} />
  {:else}
    <div class="mb-3">
      <Button href="/blocks" variant="ghost" size="sm">← К списку блокировок</Button>
    </div>
    <BlockForm
      mode="edit"
      blockId={data.detail?.block.id ?? null}
      initialEdit={data}
      action={`/blocks/${data.detail?.block.id ?? ''}?next=/blocks`}
      variant="card"
    />
  {/if}
</div>
