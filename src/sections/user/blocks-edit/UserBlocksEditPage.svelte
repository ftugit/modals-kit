<script lang="ts">
  // Карточка редактирования / просмотра блокировки конкретного пользователя (`/user/[id]/blocks/[blockId]`).
  import type { loadUserBlocksEdit } from './load.server.js'
  import { useHeadSeo } from '#core/ui/shell/index.js'
  import { Button } from '#core/ui/index.js'
  import Acl from '#modules/user/base/svelte/Acl.svelte'
  import BlockForm from '#modules/user/blocks/svelte/block-form/BlockForm.svelte'
  
  let { data }: { data: Awaited<ReturnType<typeof loadUserBlocksEdit>> } = $props()

  useHeadSeo({
    subTitle: 'Блокировка пользователя',
    description: 'Просмотр и изменение блокировки пользователя.',
    noindex: true,
  })
</script>

<div class="mx-auto w-full max-w-md">
  {#if data.fact}
    <Acl status={data.fact} enabled={data.enabled} backHref={data.fact === 'auth.identity-unknown' ? '/' : `/user/${data.contextUid}/blocks`} />
  {:else}
    <div class="mb-3">
      <Button href={`/user/${data.contextUid}/blocks`} variant="ghost" size="sm">
        ← К блокировкам пользователя
      </Button>
    </div>
    <BlockForm
      mode="edit"
      uid={data.contextUid}
      blockId={data.blockId}
      initialEdit={data}
      action={`/user/${data.contextUid}/blocks/${data.blockId}?next=${encodeURIComponent(`/user/${data.contextUid}/blocks`)}`}
      variant="card"
    />
  {/if}
</div>
