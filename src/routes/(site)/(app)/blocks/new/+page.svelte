<script lang="ts">
  // Страница создания блокировки из глобального списка (`/blocks/new`) — носитель `user.blocks.create`.
  import { Button } from '#components/ui/index.js'
  import Acl from '#content/user/ui/Acl.svelte'
  import BlockForm from '#content/user/ui/block-form/BlockForm.svelte'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()
</script>

<svelte:head><title>Наложить блокировку</title></svelte:head>

<div class="mx-auto w-full max-w-md">
  {#if data.fact === 'auth.forbidden'}
    <Acl model="forbidden" backHref="/blocks" />
  {:else if data.fact}
    <Acl status={data.fact} backHref="/blocks" />
  {:else}
    <div class="mb-3">
      <Button href="/blocks" variant="ghost" size="sm">← К списку блокировок</Button>
    </div>
    <BlockForm
      mode="create"
      initialCreate={data}
      initialSubject={data.initialSubject}
      selfHref={data.selfHref}
      action="/blocks/new?next=/blocks"
    />
  {/if}
</div>
