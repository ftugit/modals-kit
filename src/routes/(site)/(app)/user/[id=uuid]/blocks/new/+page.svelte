<script lang="ts">
  // Страница создания блокировки конкретного пользователя (`/user/[id]/blocks/new`).
  import { useHeadSeo } from '#components/shell/index.js'
  import { Button } from '#components/ui/index.js'
  import Acl from '#content/user/ui/Acl.svelte'
  import BlockForm from '#content/user/ui/block-form/BlockForm.svelte'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()

  useHeadSeo({
    subTitle: 'Наложить блокировку',
    description: 'Наложение новой блокировки на пользователя.',
    noindex: true,
  })
</script>

<div class="mx-auto w-full max-w-md">
  {#if data.fact === 'auth.identity-unknown'}
    <Acl model="not_found" backHref="/" />
  {:else if data.fact === 'auth.forbidden'}
    <Acl model="forbidden" backHref={`/user/${data.uid}/blocks`} />
  {:else if data.fact}
    <Acl status={data.fact} backHref={`/user/${data.uid}/blocks`} />
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
    />
  {/if}
</div>
