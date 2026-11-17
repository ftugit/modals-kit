<script lang="ts">
  // Страница создания блокировки конкретного пользователя (`/user/[id]/blocks/new`).
  import type { loadUserBlocksNew } from './load.server.js'
  import { useHeadSeo } from '#core/ui/shell/index.js'
  import { Button } from '#core/ui/index.js'
  import Acl from '#modules/user/base/svelte/Acl.svelte'
  import BlockForm from '#modules/user/blocks/svelte/block-form/BlockForm.svelte'
  
  let { data }: { data: Awaited<ReturnType<typeof loadUserBlocksNew>> } = $props()

  useHeadSeo({
    subTitle: 'Наложить блокировку',
    description: 'Наложение новой блокировки на пользователя.',
    noindex: true,
  })
</script>

<div class="mx-auto w-full max-w-md">
  {#if data.fact}
    <Acl status={data.fact} enabled={data.enabled} backHref={data.fact === 'auth.identity-unknown' ? '/' : `/user/${data.uid}/blocks`} />
  {:else}
    <div class="mb-3">
      <Button href={`/user/${data.uid}/blocks`} variant="ghost" size="sm">
        ← К блокировкам пользователя
      </Button>
    </div>
    <BlockForm
      mode="create"
      uid={data.uid}
      initialCreate={data}
      action={`/user/${data.uid}/blocks/new?next=${encodeURIComponent(`/user/${data.uid}/blocks`)}`}
      variant="card"
    />
  {/if}
</div>
