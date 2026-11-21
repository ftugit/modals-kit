<script lang="ts">
  /** Карточка узла (`drive.node`): тонкий носитель над загрузчиком `/drive/node/[id]`. */
  import { invalidateAll } from '$app/navigation'
  import { useLoader, useModals } from '#core/lib/modals/svelte/index.js'
  import Acl from '#modules/user/base/svelte/Acl.svelte'
  import { Button, Surface } from '#core/ui/index.js'
  import { driveFolderRoute, driveNodeRoute } from '../routes.js'
  import type { DriveNodePageData } from '../types.js'
  import DriveNodeCard from './DriveNodeCard.svelte'

  const m = useModals()
  const ldr = useLoader<DriveNodePageData>()
  const data = $derived(ldr.data)
</script>

<Surface variant="plain" class="flex min-h-0 flex-1 flex-col w-full p-4 sm:p-6">
  {#if data?.fact}
    <Acl status={data.fact} enabled={data.enabled} backHref="/" variant="plain" />
  {:else if data?.node}
    <div class="flex flex-col gap-4">
      <DriveNodeCard
        entry={{ node: data.node, caps: data.caps }}
        variant="detail"
        trashed={data.node.trashedAt !== null}
        returnTo={driveNodeRoute.href({ id: data.node.id })}
        downloadHref={data.downloadHref}
      />
      {#if data.node.kind === 'folder'}
        <Button href={driveFolderRoute.href({ folderId: data.node.id })} variant="outline" size="sm">
          Открыть папку
        </Button>
      {/if}
      <div class="flex justify-end">
        <Button
          type="button"
          variant="ghost"
          onclick={() => {
            void invalidateAll()
            m.modals.close()
            m.modals.invalidateLoader('drive.node')
          }}
        >
          Закрыть
        </Button>
      </div>
    </div>
  {/if}
</Surface>
