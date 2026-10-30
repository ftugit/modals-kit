<script lang="ts">
  // Страница удаления блокировки из глобального списка (`/blocks/[blockId]/delete`).
  import { useHeadSeo } from '#components/shell/index.js'
  import { Button } from '#components/ui/index.js'
  import Acl from '#content/user/ui/Acl.svelte'
  import BlockDelete from '#content/user/ui/block-delete/BlockDelete.svelte'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()

  useHeadSeo({
    subTitle: 'Удаление блокировки',
    description: 'Подтверждение снятия или окончательного удаления блокировки.',
    noindex: true,
  })
</script>

<div class="mx-auto w-full max-w-sm">
  {#if data.fact === 'auth.identity-unknown'}
    <Acl model="not_found" backHref="/blocks" />
  {:else if data.fact === 'auth.forbidden' || !data.detail?.canDelete}
    <Acl model="forbidden" backHref="/blocks" />
  {:else if data.fact}
    <Acl status={data.fact} backHref="/blocks" />
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
