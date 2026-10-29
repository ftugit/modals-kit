<script lang="ts">
  // Карточка редактирования / просмотра блокировки конкретного пользователя (`/user/[id]/blocks/[blockId]`).
  import { Button } from '#components/ui/index.js'
  import Acl from '#content/user/ui/Acl.svelte'
  import BlockForm from '#content/user/ui/block-form/BlockForm.svelte'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()
</script>

<svelte:head><title>Блокировка пользователя</title></svelte:head>

<div class="mx-auto w-full max-w-md">
  {#if data.fact === 'auth.identity-unknown'}
    <Acl model="not_found" backHref={`/user/${data.contextUid}/blocks`} />
  {:else if data.fact === 'auth.forbidden'}
    <Acl model="forbidden" backHref={`/user/${data.contextUid}/blocks`} />
  {:else if data.fact}
    <Acl status={data.fact} backHref={`/user/${data.contextUid}/blocks`} />
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
    />
  {/if}
</div>
