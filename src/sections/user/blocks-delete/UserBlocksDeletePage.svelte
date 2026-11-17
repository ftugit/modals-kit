<script lang="ts">
  // Страница удаления блокировки пользователя (`/user/[id]/blocks/[blockId]/delete`).
  import type { loadUserBlocksDelete } from './load.server.js'
  import { useHeadSeo } from '#core/ui/shell/index.js'
  import { Button } from '#core/ui/index.js'
  import Acl from '#modules/user/base/svelte/Acl.svelte'
  import BlockDelete from '#modules/user/blocks/svelte/block-delete/BlockDelete.svelte'
  
  let { data }: { data: Awaited<ReturnType<typeof loadUserBlocksDelete>> } = $props()

  useHeadSeo({
    subTitle: 'Удаление блокировки',
    description: 'Подтверждение снятия или удаления блокировки пользователя.',
    noindex: true,
  })
</script>

<div class="mx-auto w-full max-w-sm">
  {#if data.fact}
    <Acl status={data.fact} enabled={data.enabled} backHref={data.fact === 'auth.identity-unknown' ? '/' : `/user/${data.contextUid}/blocks`} />
  {:else if !data.detail?.canDelete}
    <Acl status="auth.forbidden" enabled={data.enabled} backHref={`/user/${data.contextUid}/blocks`} />
  {:else}
    <div class="mb-3">
      <Button href={`/user/${data.contextUid}/blocks/${data.blockId}`} variant="ghost" size="sm">
        ← К блокировке
      </Button>
    </div>
    <BlockDelete
      blockId={data.blockId}
      uid={data.contextUid}
      initial={data}
      action={`/user/${data.contextUid}/blocks/${data.blockId}/delete?next=${encodeURIComponent(`/user/${data.contextUid}/blocks`)}`}
      doneHref={`/user/${data.contextUid}/blocks`}
      variant="card"
    />
  {/if}
</div>
