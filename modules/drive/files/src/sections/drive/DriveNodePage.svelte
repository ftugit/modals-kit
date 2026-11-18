<script lang="ts">
  // Карточка узла — страница-fallback модалки `drive.node`.
  import { untrack } from 'svelte'
  import { useHeadSeo } from '#core/ui/shell/index.js'
  import Acl from '#modules/user/base/svelte/Acl.svelte'
  import { Button, Surface } from '#core/ui/index.js'
  import { DriveNodeCard, driveFolderRoute, driveNodeRoute, driveRootRoute } from '#modules/drive/index.js'
  import type { DriveNodePageData } from '#modules/drive/types.js'

  let { data }: { data: DriveNodePageData } = $props()

  useHeadSeo({
    subTitle: untrack(() => data.node?.name ?? 'Файл'),
    description: 'Карточка файла или папки диска.',
    noindex: true,
  })
</script>

<div class="mx-auto w-full max-w-2xl">
  {#if data.fact}
    <Acl status={data.fact} enabled={data.enabled} backHref="/" />
  {:else if data.node}
    <Surface title={data.node.name} description="Файл или папка диска">
      <div class="flex flex-col gap-4">
        <DriveNodeCard
          entry={{ node: data.node, caps: data.caps }}
          variant="detail"
          trashed={data.node.trashedAt !== null}
          returnTo={driveNodeRoute.href({ id: data.node.id })}
          downloadHref={data.downloadHref}
        />
        <div class="flex gap-2">
          {#if data.node.kind === 'folder'}
            <Button href={driveFolderRoute.href({ folderId: data.node.id })} variant="outline" size="sm">
              Открыть папку
            </Button>
          {/if}
          <Button href={driveRootRoute.href()} variant="ghost" size="sm">К диску</Button>
        </div>
      </div>
    </Surface>
  {/if}
</div>
