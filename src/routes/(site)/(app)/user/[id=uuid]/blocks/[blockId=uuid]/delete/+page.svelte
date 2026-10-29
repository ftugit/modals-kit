<script lang="ts">
  // Страница удаления блокировки пользователя (`/user/[id]/blocks/[blockId]/delete`).
  import { Button } from '#components/ui/index.js'
  import Acl from '#content/user/ui/Acl.svelte'
  import BlockDelete from '#content/user/ui/block-delete/BlockDelete.svelte'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()
</script>

<svelte:head><title>Удаление блокировки</title></svelte:head>

<div class="mx-auto w-full max-w-sm">
  {#if data.fact === 'auth.identity-unknown'}
    <Acl model="not_found" backHref={`/user/${data.contextUid}/blocks`} />
  {:else if data.fact === 'auth.forbidden' || !data.detail?.canDelete}
    <Acl model="forbidden" backHref={`/user/${data.contextUid}/blocks`} />
  {:else if data.fact}
    <Acl status={data.fact} backHref={`/user/${data.contextUid}/blocks`} />
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
    />
  {/if}
</div>
