<script lang="ts">
  // Страница удаления блокировки из глобального списка (`/blocks/[blockId]/delete`).
  import type { loadBlocksDelete } from './load.server.js'
  import { useHeadSeo } from '#core/ui/shell/index.js'
  import { Button } from '#core/ui/index.js'
  import Acl from '#modules/user/base/svelte/Acl.svelte'
  import BlockDelete from '#modules/user/blocks/svelte/block-delete/BlockDelete.svelte'
  
  let { data }: { data: Awaited<ReturnType<typeof loadBlocksDelete>> } = $props()

  useHeadSeo({
    subTitle: 'Удаление блокировки',
    description: 'Подтверждение снятия или окончательного удаления блокировки.',
    noindex: true,
  })
</script>

<div class="mx-auto w-full max-w-sm">
  {#if data.fact}
    <Acl status={data.fact} enabled={data.enabled} backHref={'/blocks'} />
  {:else if !data.detail?.canDelete}
    <Acl status="auth.forbidden" enabled={data.enabled} backHref={'/blocks'} />
  {:else}
    <div class="mb-3">
      <Button href={`/blocks/${data.blockId}`} variant="ghost" size="sm">← К блокировке</Button>
    </div>
    <BlockDelete
      blockId={data.blockId}
      initial={data}
      action={`/blocks/${data.blockId}/delete?next=/blocks`}
      doneHref="/blocks"
      variant="card"
    />
  {/if}
</div>
