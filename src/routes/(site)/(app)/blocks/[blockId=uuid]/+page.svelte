<script lang="ts">
  // Карточка редактирования / просмотра блокировки из глобального списка (`/blocks/[blockId]`).
  import { useHeadSeo } from '#components/shell/index.js'
  import { Button } from '#components/ui/index.js'
  import Acl from '#content/user/ui/Acl.svelte'
  import BlockForm from '#content/user/ui/block-form/BlockForm.svelte'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()

  useHeadSeo({
    subTitle: 'Блокировка',
    description: 'Просмотр и редактирование записи о блокировке.',
    noindex: true,
  })
</script>

<div class="mx-auto w-full max-w-md">
  {#if data.fact === 'auth.identity-unknown'}
    <Acl model="not_found" backHref="/blocks" />
  {:else if data.fact === 'auth.forbidden'}
    <Acl model="forbidden" backHref="/blocks" />
  {:else if data.fact}
    <Acl status={data.fact} backHref="/blocks" />
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
