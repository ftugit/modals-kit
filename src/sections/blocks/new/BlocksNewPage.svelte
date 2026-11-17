<script lang="ts">
  // Страница создания блокировки из глобального списка (`/blocks/new`) — носитель `user.blocks.create`.
  import type { loadBlocksNew } from './load.server.js'
  import { useHeadSeo } from '#core/ui/shell/index.js'
  import { Button } from '#core/ui/index.js'
  import { visibleAddress, writeAddress } from '#core/lib/address/sveltekit.js'
  import { blocksCreateRoute } from '#modules/user/base/routes.js'
  import Acl from '#modules/user/base/svelte/Acl.svelte'
  import BlockForm from '#modules/user/blocks/svelte/block-form/BlockForm.svelte'
  
  let { data }: { data: Awaited<ReturnType<typeof loadBlocksNew>> } = $props()

  useHeadSeo({
    subTitle: 'Наложить блокировку',
    description: 'Создание новой блокировки для одного или нескольких пользователей.',
    noindex: true,
  })

  const activeUidsCsv = $derived.by(() => {
    const sp = visibleAddress().url.searchParams
    const raw = sp.get('uids') ?? sp.get('subjects') ?? sp.get('subject')
    if (raw !== null) return raw.trim()
    return (data.initialSubjects ?? []).join(',')
  })

  const actionHref = $derived(
    activeUidsCsv
      ? `/blocks/new?uids=${encodeURIComponent(activeUidsCsv)}&next=/blocks`
      : '/blocks/new?next=/blocks',
  )

  function syncSubjectsToPageUrl(ids: string[]) {
    const csv = ids.filter(Boolean).join(',')
    void writeAddress(
      (cur) => ({
        url: blocksCreateRoute.patch(cur.url, {
          uids: csv || null,
          subjects: null,
          subject: null,
        }),
      }),
      { replace: true, load: false, owner: 'blocks.create' },
    )
  }
</script>

<div class="mx-auto w-full max-w-md">
  {#if data.fact}
    <Acl status={data.fact} enabled={data.enabled} backHref="/blocks" />
  {:else}
    <div class="mb-3">
      <Button href="/blocks" variant="ghost" size="sm">← К списку блокировок</Button>
    </div>
    <BlockForm
      mode="create"
      initialCreate={data}
      initialSubjects={data.initialSubjects}
      initialSubject={data.initialSubject}
      selfHref={data.selfHref}
      action={actionHref}
      onSubjectsChange={syncSubjectsToPageUrl}
      variant="card"
    />
  {/if}
</div>
