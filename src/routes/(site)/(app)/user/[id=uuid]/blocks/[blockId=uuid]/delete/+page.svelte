<script lang="ts">
  // Страница удаления блокировки пользователя (`/user/[id]/blocks/[blockId]/delete`).
  import { useHeadSeo } from '#components/shell/index.js'
  import { Button } from '#components/ui/index.js'
  import Acl from '#content/user/ui/Acl.svelte'
  import BlockDelete from '#content/user/ui/block-delete/BlockDelete.svelte'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()

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
